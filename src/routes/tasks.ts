import express from 'express';
import { airtableService } from '../services/airtableService';
import { TaskStatus, TaskAction } from '../types';

const router = express.Router();

// GET /api/tasks/:id
// Get detailed task information
router.get('/:id', async (req, res) => {
    try {
        const task_id = req.params.id;
        const task = await airtableService.getTaskById(task_id);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        // Add conflict resolution headers for debugging
        res.setHeader('X-Last-Modified', task.lastModifiedAt || 'unknown');
        res.setHeader('X-Server-Timestamp', new Date().toISOString());

        res.json({
            success: true,
            data: task
        });

    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch task',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// POST /api/tasks/action
// Handle task status transitions and actions
router.post('/action', async (req, res) => {
    try {
        const { task_id, action, operator_id, payload } = req.body;

        console.log('DEBUG: Task action request body:', JSON.stringify(req.body, null, 2));
        console.log('DEBUG: task_id exists:', !!task_id);
        console.log('DEBUG: action exists:', !!action);
        console.log('DEBUG: operator_id exists:', !!operator_id);

        if (!task_id || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: task_id and action'
            });
        }

        let updatedTask;
        const currentTime = new Date().toISOString();

        switch (action) {
            case TaskAction.START_PICKING:
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.PICKING,
                    operator_id
                );
                break;

            // COMPLETE_PICKING removed - no longer exists in simplified design

            case TaskAction.START_PACKING:
                console.log(`🔄 START_PACKING: Received payload:`, payload);
                console.log(`🔄 VALIDATION: Weight='${payload?.weight}', Dimensions='${payload?.dimensions}'`);

                // Validate payload for weight and dimensions
                if (!payload?.weight || !payload?.dimensions) {
                    console.log(`❌ START_PACKING FAILED: Missing weight or dimensions`);
                    return res.status(400).json({
                        success: false,
                        error: 'Weight and dimensions are required for starting packing'
                    });
                }

                console.log(`✅ START_PACKING VALIDATION PASSED: Proceeding with status update`)

                // Clear operator when transitioning to packed - task becomes available for any inspector
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.PACKED
                    // No operator_id - clears the current_operator field
                );

                // Log the action manually since we need to clear the operator
                if (operator_id) {
                    await airtableService.logAction(
                        operator_id,
                        task_id,
                        TaskAction.START_PACKING,
                        TaskStatus.PICKING, // Changed from PICKED to PICKING since intermediate status removed
                        TaskStatus.PACKED,
                        `Started packing. Weight: ${payload.weight}, Dimensions: ${payload.dimensions}`
                    );
                }
                break;

            case TaskAction.START_INSPECTION:
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.INSPECTING,
                    operator_id
                );
                break;

            // COMPLETE_INSPECTION_CRITERIA removed - no longer needed in optimistic inspection flow

            case TaskAction.COMPLETE_INSPECTION:
                // Get current task status before updating
                const currentInspectionTask = await airtableService.getTaskById(task_id);
                const oldInspectionStatus = currentInspectionTask?.status;

                // Clear operator when completing - task is done, no operator needed
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.COMPLETED
                    // No operator_id - clears the current_operator field
                );

                // Log the action manually to preserve operator info in audit trail
                if (operator_id && oldInspectionStatus) {
                    await airtableService.logAction(
                        operator_id,
                        task_id,
                        TaskAction.COMPLETE_INSPECTION,
                        oldInspectionStatus,
                        TaskStatus.COMPLETED,
                        'Inspection completed successfully'
                    );
                }
                break;

            case TaskAction.ENTER_CORRECTION:
                // Handle inspection failure and correction
                if (!payload?.errorType) {
                    return res.status(400).json({
                        success: false,
                        error: 'Error type is required for corrections'
                    });
                }

                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.CORRECTION_NEEDED,
                    operator_id
                );
                break;

            case TaskAction.START_CORRECTION:
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.CORRECTING,
                    operator_id
                );
                break;

            case TaskAction.RESOLVE_CORRECTION:
                // Complete the task directly - no need for further inspection after correction
                // Get current task status before updating
                const currentCorrectionTask = await airtableService.getTaskById(task_id);
                const oldCorrectionStatus = currentCorrectionTask?.status;

                // Clear operator when completing - task is done, no operator needed
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.COMPLETED
                    // No operator_id - clears the current_operator field
                );

                // Log the action manually to preserve operator info in audit trail
                if (operator_id && oldCorrectionStatus) {
                    await airtableService.logAction(
                        operator_id,
                        task_id,
                        TaskAction.RESOLVE_CORRECTION,
                        oldCorrectionStatus,
                        TaskStatus.COMPLETED,
                        'Correction resolved and task completed'
                    );
                }
                break;

            case TaskAction.LABEL_CREATED:
                // Print New Label action - complete the task directly after label creation
                // Get current task status before updating
                const currentTask = await airtableService.getTaskById(task_id);
                const oldStatus = currentTask?.status;

                // Clear operator when completing - task is done, no operator needed
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.COMPLETED
                    // No operator_id - clears the current_operator field
                );

                // Log the specific LABEL_CREATED action manually to preserve it in audit log
                if (operator_id && oldStatus) {
                    await airtableService.logAction(
                        operator_id,
                        task_id,
                        TaskAction.LABEL_CREATED,
                        oldStatus,
                        TaskStatus.COMPLETED,
                        `New label printed. Task completed.`
                    );
                }
                break;

            case TaskAction.PAUSE_TASK:
                // Use atomic pause method that handles audit logging
                updatedTask = await airtableService.pauseTask(task_id, operator_id);
                break;

            case TaskAction.CANCEL_TASK:
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.CANCELLED,
                    operator_id
                );
                break;

            case TaskAction.REPORT_EXCEPTION:
                if (!payload?.reason) {
                    return res.status(400).json({
                        success: false,
                        error: 'Exception reason is required'
                    });
                }

                // Get current task status before updating
                const currentExceptionTask = await airtableService.getTaskById(task_id);
                const oldExceptionStatus = currentExceptionTask?.status;

                // Transition task to PENDING status after reporting issue
                updatedTask = await airtableService.updateTaskStatus(
                    task_id,
                    TaskStatus.PENDING,
                    operator_id
                );

                // Log exception with status transition
                if (operator_id && oldExceptionStatus) {
                    await airtableService.logAction(
                        operator_id,
                        task_id,
                        TaskAction.REPORT_EXCEPTION,
                        oldExceptionStatus,
                        TaskStatus.PENDING,
                        `Exception reported: ${payload.reason} - ${payload.notes || ''}`
                    );
                }
                break;

            case TaskAction.RESUME_TASK:
                if (!operator_id) {
                    return res.status(400).json({
                        success: false,
                        error: 'Operator ID is required for resuming tasks'
                    });
                }

                updatedTask = await airtableService.resumeTask(task_id, operator_id);
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown action: ${action}`
                });
        }

        if (!updatedTask) {
            return res.status(404).json({
                success: false,
                error: 'Task not found or update failed'
            });
        }

        // Add conflict resolution headers for debugging
        res.setHeader('X-Last-Modified', updatedTask.lastModifiedAt || 'unknown');
        res.setHeader('X-Server-Timestamp', currentTime);
        res.setHeader('X-Action-Performed', action);

        res.json({
            success: true,
            data: updatedTask,
            action: action,
            timestamp: currentTime
        });

    } catch (error) {
        console.error('Task action error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to perform task action',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// PUT /api/tasks/:id/checklist
// Update task checklist (for barcode scanning results)
router.put('/:id/checklist', async (req, res) => {
    try {
        const task_id = req.params.id;
        const { checklist_json, operator_id } = req.body;

        console.log('DEBUG: Checklist update request body:', JSON.stringify(req.body, null, 2));
        console.log('DEBUG: checklist_json exists:', !!checklist_json);
        console.log('DEBUG: operator_id exists:', !!operator_id);

        if (!checklist_json) {
            return res.status(400).json({
                success: false,
                error: 'checklist_json is required'
            });
        }

        const updatedTask = await airtableService.updateTaskChecklist(task_id, checklist_json);

        if (!updatedTask) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        // Checklist updates are too granular for audit log - removed to reduce noise

        res.json({
            success: true,
            data: updatedTask
        });

    } catch (error) {
        console.error('Update checklist error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update checklist',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// GET /api/tasks/:id/history
// Get work history/audit log for a specific task
router.get('/:id/history', async (req, res) => {
    try {
        const task_id = req.params.id;

        const workHistory = await airtableService.getTaskWorkHistory(task_id);

        res.json({
            success: true,
            data: workHistory
        });

    } catch (error) {
        console.error('Get task history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch task history',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;