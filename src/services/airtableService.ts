import Airtable from 'airtable';
import { FulfillmentTask, StaffMember, TaskStatus } from '../types';

// Initialize Airtable
const base = new Airtable({
    apiKey: process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN
}).base(process.env.AIRTABLE_BASE_ID!);

// Table references
const TASKS_TABLE = 'Tasks';
const STAFF_TABLE = 'Staff';
const ORDERS_TABLE = 'Orders';
const AUDIT_LOG_TABLE = 'Audit_Log';


export class AirtableService {

    // MARK: - Tasks Operations

    async getAllTasks(): Promise<FulfillmentTask[]> {
        try {
            const records = await base(TASKS_TABLE)
                .select({
                    view: 'Grid view', // or your default view name
                    sort: [{ field: 'created_at', direction: 'desc' }]
                })
                .all();

            return await this.mapTaskRecords([...records]); // Convert readonly array to mutable
        } catch (error) {
            console.error('Error fetching tasks:', error);
            throw new Error('Failed to fetch tasks from Airtable');
        }
    }

    async getAllTasksOptimized(): Promise<{ tasks: FulfillmentTask[], lastModified: string }> {
        try {
            console.log('🔄 FETCHING FRESH DATA: Always fetching from Airtable for consistency');

            const records = await base(TASKS_TABLE)
                .select({
                    view: 'Grid view',
                    sort: [{ field: 'created_at', direction: 'desc' }]
                })
                .all();

            // Simple timestamp for last modified
            const lastModified = new Date().toISOString();

            console.log('🔄 PROCESSING: Processing with batch mapping');

            // Process with batch mapping
            const tasks = await this.mapTaskRecords([...records]);

            return { tasks, lastModified };
        } catch (error) {
            console.error('Error fetching optimized tasks:', error);
            throw new Error('Failed to fetch tasks from Airtable');
        }
    }

    async getTaskById(taskId: string): Promise<FulfillmentTask | null> {
        try {
            const record = await base(TASKS_TABLE).find(taskId);
            return await this.mapTaskRecord(record);
        } catch (error) {
            console.error('Error fetching task:', error);
            return null;
        }
    }

    async updateTaskStatus(taskId: string, status: TaskStatus, operatorId?: string): Promise<FulfillmentTask | null> {
        try {
            // Get current task status for audit logging
            const currentTask = await this.getTaskById(taskId);
            if (!currentTask) {
                return null;
            }

            const updateFields: any = {
                status: status,
                updated_at: new Date().toISOString()
            };

            // Add status-specific timestamps
            const now = new Date().toISOString();
            switch (status) {
                case TaskStatus.PICKING:
                    updateFields.started_at = now;
                    break;
                case TaskStatus.PACKED:
                    updateFields.picked_at = now;
                    break;
                case TaskStatus.INSPECTING:
                    updateFields.start_inspection_at = now;
                    break;
                case TaskStatus.COMPLETED:
                    updateFields.completed_at = now;
                    break;
            }

            if (operatorId) {
                // operatorId is already a staff_id value (like "CAT001"), use it directly
                updateFields.current_operator = operatorId;
            } else {
                // Explicitly clear the operator field when no operatorId provided
                updateFields.current_operator = '';
            }

            // Use atomic operation if operatorId is provided (for audit logging)
            if (operatorId) {
                const actionType = this.getActionTypeForStatus(status);
                const result = await this.atomicTaskOperation(
                    taskId,
                    operatorId,
                    actionType,
                    updateFields,
                    currentTask.status, // oldValue = current status before update
                    status,
                    `Status updated from ${currentTask.status} to ${status}`
                );
                return result.task;
            } else {
                // Direct update for system operations (no audit needed)
                const record = await base(TASKS_TABLE).update(taskId, updateFields);
                return await this.mapTaskRecord(record);
            }
        } catch (error) {
            console.error('Error updating task status:', error);
            throw new Error('Failed to update task status');
        }
    }

    async pauseTask(taskId: string, operatorId?: string): Promise<FulfillmentTask | null> {
        try {
            const updateFields: any = {
                is_paused: true,
                current_operator: '', // Clear operator when pausing
                updated_at: new Date().toISOString()
            };

            // Use atomic operation if operatorId is provided
            if (operatorId) {
                const currentTask = await this.getTaskById(taskId);
                const result = await this.atomicTaskOperation(
                    taskId,
                    operatorId,
                    'PAUSE_TASK',
                    updateFields,
                    currentTask?.status,
                    currentTask?.status,
                    'Task paused by operator'
                );
                return result.task;
            } else {
                // Direct update for system operations
                const record = await base(TASKS_TABLE).update(taskId, updateFields);
                return await this.mapTaskRecord(record);
            }
        } catch (error) {
            console.error('Error pausing task:', error);
            throw new Error('Failed to pause task');
        }
    }

    async resumeTask(taskId: string, operatorId: string): Promise<FulfillmentTask | null> {
        try {
            // Get current task status for audit logging
            const currentTask = await this.getTaskById(taskId);
            if (!currentTask) {
                return null;
            }

            const updateFields: any = {
                is_paused: false,
                updated_at: new Date().toISOString()
            };

            // Assign the resuming operator
            if (operatorId) {
                // operatorId is already a staff_id value (like "CAT001"), use it directly
                updateFields.current_operator = operatorId;
            }

            // Use atomic operation for resume
            const result = await this.atomicTaskOperation(
                taskId,
                operatorId,
                'RESUME_TASK',
                updateFields,
                'Paused',
                currentTask.status,
                `Task resumed from ${currentTask.status} status`
            );

            return result.task;
        } catch (error) {
            console.error('Error resuming task:', error);
            throw new Error('Failed to resume task');
        }
    }

    async updateTaskChecklist(taskId: string, checklistJson: string): Promise<FulfillmentTask | null> {
        try {
            const record = await base(TASKS_TABLE).update(taskId, {
                checklist_json: checklistJson,
                updated_at: new Date().toISOString()
            });
            return await this.mapTaskRecord(record);
        } catch (error) {
            console.error('Error updating task checklist:', error);
            throw new Error('Failed to update task checklist');
        }
    }

    // MARK: - Staff Operations

    async getAllStaff(): Promise<StaffMember[]> {
        try {
            const records = await base(STAFF_TABLE).select().all();
            return records.map(record => ({
                id: record.get('staff_id') as string, // Use staff_id field instead of record ID
                name: record.get('name') as string
            }));
        } catch (error) {
            console.error('Error fetching staff:', error);
            throw new Error('Failed to fetch staff from Airtable');
        }
    }

    async getAllStaffOptimized(): Promise<{ staff: StaffMember[], lastModified: string }> {
        try {
            console.log('🔄 FETCHING FRESH STAFF DATA: Always fetching from Airtable for consistency');

            const records = await base(STAFF_TABLE).select().all();

            // Simple timestamp for last modified
            const lastModified = new Date().toISOString();

            console.log('🔄 STAFF PROCESSING: Processing fresh staff data');

            // Process fresh data
            const staff = records.map(record => ({
                id: record.get('staff_id') as string,
                name: record.get('name') as string
            }));

            return { staff, lastModified };
        } catch (error) {
            console.error('Error fetching optimized staff:', error);
            throw new Error('Failed to fetch staff from Airtable');
        }
    }

    async getStaffById(staffId: string): Promise<StaffMember | null> {
        try {
            // Find staff record by staff_id field value instead of record ID
            const records = await base(STAFF_TABLE)
                .select({
                    filterByFormula: `{staff_id} = '${staffId}'`
                })
                .all();

            if (records.length > 0) {
                const record = records[0];
                return {
                    id: record.get('staff_id') as string,
                    name: record.get('name') as string
                };
            }
            return null;
        } catch (error) {
            console.error('Error fetching staff member:', error);
            return null;
        }
    }

    /**
     * Helper method to get Airtable record ID from staff_id
     */
    async getStaffRecordId(staffId: string): Promise<string | null> {
        try {
            const records = await base(STAFF_TABLE)
                .select({
                    filterByFormula: `{staff_id} = '${staffId}'`
                })
                .all();

            if (records.length > 0) {
                return records[0].id; // Return the actual Airtable record ID
            }
            return null;
        } catch (error) {
            console.error('Error fetching staff record ID:', error);
            return null;
        }
    }

    async createStaff(name: string, staffId?: string): Promise<StaffMember> {
        try {
            const fields: any = {
                name: name,
                is_active: true
            };

            // If staffId is provided, use it, otherwise generate a simple one
            if (staffId) {
                fields.staff_id = staffId;
            } else {
                // Generate a simple staff ID based on name (you can customize this logic)
                const timestamp = Date.now().toString().slice(-4);
                fields.staff_id = `STAFF_${name.toUpperCase().replace(/\s+/g, '_')}_${timestamp}`;
            }

            const record: any = await base(STAFF_TABLE).create(fields);
            return {
                id: record.get('staff_id') as string, // Return staff_id instead of record ID
                name: record.get('name') as string
            };
        } catch (error) {
            console.error('Error creating staff member:', error);
            throw new Error('Failed to create staff member');
        }
    }

    async updateStaff(staffId: string, name: string): Promise<StaffMember | null> {
        try {
            // First find the record by staff_id
            const records = await base(STAFF_TABLE)
                .select({
                    filterByFormula: `{staff_id} = '${staffId}'`
                })
                .all();

            if (records.length === 0) {
                return null;
            }

            const record: any = await base(STAFF_TABLE).update(records[0].id, {
                name: name
            });
            return {
                id: record.get('staff_id') as string,
                name: record.get('name') as string
            };
        } catch (error) {
            console.error('Error updating staff member:', error);
            return null;
        }
    }

    async deleteStaff(staffId: string): Promise<boolean> {
        try {
            // First find the record by staff_id
            const records = await base(STAFF_TABLE)
                .select({
                    filterByFormula: `{staff_id} = '${staffId}'`
                })
                .all();

            if (records.length === 0) {
                return false;
            }

            await base(STAFF_TABLE).destroy(records[0].id);

            return true;
        } catch (error) {
            console.error('Error deleting staff member:', error);
            return false;
        }
    }

    // MARK: - Exception Pool Management

    async moveTaskToExceptionPool(
        taskId: string,
        exceptionReason: string,
        description: string,
        _reportingOperatorId: string
    ): Promise<void> {
        try {
            const now = new Date().toISOString();

            await base(TASKS_TABLE).update(taskId, {
                status: TaskStatus.PENDING,
                in_exception_pool: true,
                exception_reason: exceptionReason,
                exception_notes: description,
                exception_logged_at: now,
                current_operator: '', // Clear current operator
                return_to_pending_at: now,
                updated_at: now
            });

            console.log(`Task ${taskId} moved to exception pool with reason: ${exceptionReason} and description: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`);
        } catch (error) {
            console.error('Error moving task to exception pool:', error);
            throw new Error('Failed to move task to exception pool');
        }
    }

    // MARK: - Audit Log

    async getTaskWorkHistory(taskId: string): Promise<any[]> {
        try {
            const records = await base(AUDIT_LOG_TABLE)
                .select({
                    filterByFormula: `{task_id} = '${taskId}'`,
                    sort: [{ field: 'timestamp', direction: 'asc' }]
                })
                .all();

            return await Promise.all(records.map(async (record: any) => {
                const fields = record.fields;

                // Get staff name from linked record
                let operatorName = 'Unknown';
                if (fields.staff_id && Array.isArray(fields.staff_id) && fields.staff_id.length > 0) {
                    try {
                        const staffRecord = await base(STAFF_TABLE).find(fields.staff_id[0]);
                        operatorName = staffRecord.fields.name as string || 'Unknown';
                    } catch (error) {
                        console.error('Error fetching staff name:', error);
                    }
                }

                return {
                    id: record.id,
                    timestamp: fields.timestamp,
                    action: this.formatActionForDisplay(fields.action_type as string, fields.details as string),
                    operatorName: operatorName,
                    icon: this.getActionIcon(fields.action_type as string),
                    details: fields.details || ''
                };
            }));
        } catch (error) {
            console.error('Error fetching task work history:', error);
            throw new Error('Failed to fetch task work history');
        }
    }

    async logAction(
        operatorId: string,
        taskId: string,
        actionType: string,
        oldValue?: string,
        newValue?: string,
        details?: string,
        timestamp?: string
    ): Promise<boolean> {
        let staffRecordId: string | null = null;
        let staffName = 'Unknown';
        let auditFields: any = {};

        try {

            // Handle "unknown" staff gracefully
            if (operatorId === 'unknown' || operatorId === '') {
                console.log(`📝 AUDIT LOG: Using placeholder for unknown staff on task ${taskId}`);
                // Use null for staff_id to indicate unknown operator
                staffRecordId = null;
                staffName = 'Unknown Operator';
            } else {
                // Try to find the staff member
                const staffMember = await this.getStaffById(operatorId);
                if (!staffMember) {
                    console.warn(`⚠️  Staff member ${operatorId} not found, using unknown placeholder`);
                    staffRecordId = null;
                    staffName = `Unknown (${operatorId})`;
                } else {
                    // Get the Airtable record ID for the staff member
                    staffRecordId = await this.getStaffRecordId(operatorId);
                    if (!staffRecordId) {
                        console.warn(`⚠️  Staff record ID not found for ${operatorId}, using unknown placeholder`);
                        staffName = staffMember.name || `Unknown (${operatorId})`;
                    } else {
                        staffName = staffMember.name;
                    }
                }
            }


            // Map complex action types to simpler ones that exist in Airtable
            const mappedActionType = this.mapActionType(actionType);

            // Prepare fields, avoiding empty strings for multiple choice fields
            auditFields = {
                timestamp: timestamp || new Date().toISOString(),
                task_id: taskId, // Single line text
                action_type: mappedActionType,
                details: `${actionType}: ${details || ''} (by ${staffName})`.trim() // Include original action and staff name
            };

            // Only add staff_id if we have a valid record ID
            if (staffRecordId) {
                auditFields.staff_id = [staffRecordId]; // Link to Staff (using actual record ID)
            }
            // If no valid staff record, the details field will indicate who performed the action

            // Only include old_value and new_value if they have actual content
            // This avoids issues with multiple choice fields that don't accept empty strings
            if (oldValue && oldValue.trim() !== '') {
                auditFields.old_value = oldValue.trim();
            }
            if (newValue && newValue.trim() !== '') {
                auditFields.new_value = newValue.trim();
            }

            await base(AUDIT_LOG_TABLE).create(auditFields);

            console.log(`✅ Audit log created: ${actionType} by ${staffName} on task ${taskId}`);
            return true;
        } catch (error) {
            console.error('❌ Error logging action:', {
                fullError: error,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                errorStack: error instanceof Error ? error.stack : undefined,
                operatorId,
                taskId,
                actionType,
                timestamp,
                staffRecordId: staffRecordId ?? 'null (unknown staff)',
                auditFields
            });
            // Still don't throw for audit logging, but provide detailed error info
            return false;
        }
    }

    // Helper method to determine action type from status change
    private getActionTypeForStatus(status: TaskStatus): string {
        switch (status) {
            case TaskStatus.PICKING:
                return 'START_PICKING';
            case TaskStatus.PACKED:
                return 'START_PACKING';
            case TaskStatus.INSPECTING:
                return 'START_INSPECTION';
            case TaskStatus.COMPLETED:
                return 'COMPLETE_INSPECTION';
            case TaskStatus.CANCELLED:
                return 'CANCEL_TASK';
            case TaskStatus.CORRECTION_NEEDED:
                return 'ENTER_CORRECTION';
            case TaskStatus.CORRECTING:
                return 'START_CORRECTION';
            default:
                return 'FIELD_UPDATED';
        }
    }

    // Helper method to map action types to valid Airtable options
    private mapActionType(actionType: string): string {
        // Map to actual action types that exist in Airtable Audit_Log table
        const actionMappings: { [key: string]: string } = {
            // TaskAction enum mappings
            'START_PICKING': 'Task_Started',
            'START_PACKING': 'Packing_Started',
            'START_INSPECTION': 'Inspection_Started',
            'COMPLETE_INSPECTION': 'Task_Completed',
            'ENTER_CORRECTION': 'Inspection_Failed',
            'START_CORRECTION': 'Correction_Started',
            'RESOLVE_CORRECTION': 'Correction_Completed',
            'LABEL_CREATED': 'Other_Actions', // Label creation is a misc action
            'REPORT_EXCEPTION': 'Exception_Logged',
            'PAUSE_TASK': 'Task_Paused',
            'RESUME_TASK': 'Task_Resumed',
            'CANCEL_TASK': 'Task_Auto_Cancelled',

            // ViewModel specific action types
            'INSPECTION_PASSED': 'Task_Completed',
            'INSPECTION_FAILED': 'Inspection_Failed',
            'TASK_PAUSED': 'Task_Paused',
            'CORRECTION_STARTED': 'Correction_Started',
            'TASK_COMPLETED': 'Task_Completed',

            // Generic action types (for test/fallback scenarios)
            'status_change': 'Other_Actions',
            'checklist_update': 'Other_Actions'
        };

        return actionMappings[actionType] || 'Other_Actions'; // Clean fallback for unknown actions
    }

    // Helper method to format action for display
    private formatActionForDisplay(actionType: string, details: string): string {
        // Extract original action from details if possible
        const originalAction = details.split(':')[0];

        const displayMappings: { [key: string]: string } = {
            'Task_Started': 'Task Started',
            // 'Task_Picked': removed - no longer exists in simplified design
            'Packing_Started': 'Packing Completed',
            'Inspection_Started': 'Inspection Started',
            'Task_Completed': 'Task Completed', // Optimistic inspection completion
            'Inspection_Failed': 'Inspection Failed - Correction Required',
            'Correction_Started': 'Correction Started',
            'Correction_Completed': 'Task Completed via Correction',
            'Field_Updated': 'Updated',
            'Exception_Logged': 'Exception Reported',
            'Task_Paused': 'Task Paused',
            'Task_Resumed': 'Task Resumed',
            'Task_Auto_Cancelled': 'Task Cancelled'
        };

        // Use original action if it's in our mappings, otherwise use the mapped display text
        if (originalAction && originalAction !== actionType) {
            return displayMappings[originalAction] || originalAction.replace('_', ' ');
        }

        return displayMappings[actionType] || actionType.replace('_', ' ');
    }

    // Helper method to get appropriate icon for action
    private getActionIcon(actionType: string): string {
        const iconMappings: { [key: string]: string } = {
            'Task_Started': 'play.circle',
            // 'Task_Picked': removed - no longer exists in simplified design
            'Packing_Started': 'shippingbox',
            'Inspection_Started': 'magnifyingglass',
            'Task_Completed': 'checkmark.seal', // Optimistic inspection completion
            'Inspection_Failed': 'exclamationmark.triangle',
            'Correction_Started': 'wrench',
            'Correction_Completed': 'checkmark.circle.fill',
            'Field_Updated': 'pencil',
            'Exception_Logged': 'exclamationmark.circle',
            'Task_Paused': 'pause.circle',
            'Task_Resumed': 'play.circle',
            'Task_Auto_Cancelled': 'xmark.circle'
        };

        return iconMappings[actionType] || 'circle';
    }

    // MARK: - Helper Methods

    /**
     * Batch version of mapTaskRecord for performance optimization
     * Maps multiple task records efficiently
     */
    private async mapTaskRecords(records: any[]): Promise<FulfillmentTask[]> {
        if (records.length === 0) {
            return [];
        }

        console.log(`📊 BATCH MAPPING: Processing ${records.length} task records`);

        // Map all records
        const tasks = await Promise.all(
            records.map(record => this.mapTaskRecord(record))
        );

        console.log(`✅ BATCH MAPPING: Completed mapping ${records.length} tasks`);
        return tasks;
    }

    /**
     * Map a single task record
     */
    private async mapTaskRecord(record: any): Promise<FulfillmentTask> {
        const currentOperatorRaw = record.get('current_operator');

        // Ensure date is properly formatted as ISO8601
        const createdAtRaw = record.get('created_at');
        let createdAtISO: string;
        if (createdAtRaw) {
            // If it's already a Date object, convert to ISO string
            // If it's a string, try to parse and reformat to ensure ISO8601 compatibility
            try {
                createdAtISO = new Date(createdAtRaw).toISOString();
            } catch (error) {
                console.warn('Date parsing failed for:', createdAtRaw, 'using current date');
                createdAtISO = new Date().toISOString();
            }
        } else {
            // Fallback to current date if no created_at
            createdAtISO = new Date().toISOString();
        }

        // Get current operator if exists
        let currentOperator: StaffMember | undefined;
        if (currentOperatorRaw) {
            currentOperator = await this.getOperatorFromStaffId(currentOperatorRaw as string);
        }

        // Extract last modified timestamp for conflict resolution
        const lastModifiedAt = record.get('updated_at') as string;

        return {
            id: record.id,
            orderName: record.get('order_name') as string || '',
            status: record.get('status') as TaskStatus || TaskStatus.PENDING,
            shippingName: record.get('shipping_name') as string || '',
            createdAt: createdAtISO,
            checklistJson: record.get('checklist_json') as string || '[]',
            currentOperator: currentOperator,
            // Shipping address fields
            shippingAddress1: record.get('shipping_address1') as string || undefined,
            shippingAddress2: record.get('shipping_address2') as string || undefined,
            shippingCity: record.get('shipping_city') as string || undefined,
            shippingProvince: record.get('shipping_province') as string || undefined,
            shippingZip: record.get('shipping_zip') as string || undefined,
            shippingPhone: record.get('shipping_phone') as string || undefined,
            // Pause state
            isPaused: record.get('is_paused') as boolean || false,
            // Exception handling fields
            inExceptionPool: record.get('in_exception_pool') as boolean || false,
            exceptionReason: record.get('exception_reason') as string || undefined,
            exceptionLoggedAt: record.get('exception_logged_at') as string || undefined,
            exceptionNotes: record.get('exception_notes') as string || undefined,
            // Conflict resolution fields
            lastModifiedAt: lastModifiedAt
        };
    }

    private async mapTaskRecordLegacy(record: any): Promise<FulfillmentTask> {
        const currentOperatorRaw = record.get('current_operator');

        // Ensure date is properly formatted as ISO8601
        const createdAtRaw = record.get('created_at');
        let createdAtISO: string;
        if (createdAtRaw) {
            // If it's already a Date object, convert to ISO string
            // If it's a string, try to parse and reformat to ensure ISO8601 compatibility
            try {
                createdAtISO = new Date(createdAtRaw).toISOString();
            } catch (error) {
                console.warn('Invalid date format for task', record.id, ':', createdAtRaw);
                createdAtISO = new Date().toISOString(); // Fallback to current date
            }
        } else {
            createdAtISO = new Date().toISOString(); // Fallback to current date
        }

        // Resolve current operator if assigned
        let currentOperator: StaffMember | undefined = undefined;
        if (currentOperatorRaw) {
            let staffId: string;
            if (Array.isArray(currentOperatorRaw)) {
                // Handle array format (e.g., ["008"])
                staffId = currentOperatorRaw[0];
            } else {
                // Handle string format (e.g., "008")
                staffId = currentOperatorRaw;
            }
            currentOperator = await this.getOperatorFromStaffId(staffId);
        }


        // Handle lastModifiedAt timestamp for conflict resolution
        const updatedAtRaw = record.get('updated_at');
        let lastModifiedAtISO: string | undefined;
        if (updatedAtRaw) {
            try {
                lastModifiedAtISO = new Date(updatedAtRaw).toISOString();
            } catch (error) {
                console.warn('Invalid lastModifiedAt date format for task', record.id, ':', updatedAtRaw);
                lastModifiedAtISO = new Date().toISOString(); // Fallback to current date
            }
        }


        return {
            id: record.id,
            orderName: record.get('order_name') as string || '',
            status: record.get('status') as TaskStatus || TaskStatus.PENDING,
            shippingName: record.get('shipping_name') as string || '',
            createdAt: createdAtISO,
            checklistJson: record.get('checklist_json') as string || '[]',
            currentOperator: currentOperator,
            // Shipping address fields
            shippingAddress1: record.get('shipping_address1') as string || undefined,
            shippingAddress2: record.get('shipping_address2') as string || undefined,
            shippingCity: record.get('shipping_city') as string || undefined,
            shippingProvince: record.get('shipping_province') as string || undefined,
            shippingZip: record.get('shipping_zip') as string || undefined,
            shippingPhone: record.get('shipping_phone') as string || undefined,
            // Pause state
            isPaused: record.get('is_paused') as boolean || false,
            // Exception handling fields
            inExceptionPool: record.get('in_exception_pool') as boolean || false,
            exceptionReason: record.get('exception_reason') as string || undefined,
            exceptionLoggedAt: record.get('exception_logged_at') as string || undefined,
            exceptionNotes: record.get('exception_notes') as string || undefined,
            // Conflict resolution fields
            lastModifiedAt: lastModifiedAtISO
        };
    }

    // MARK: - Atomic Operations

    /**
     * Performs an atomic task operation: Audit-first, then task update
     * This ensures audit trail is always recorded even if task update fails
     */
    private async atomicTaskOperation(
        taskId: string,
        operatorId: string,
        actionType: string,
        taskUpdate: any,
        oldValue?: string,
        newValue?: string,
        details?: string
    ): Promise<{ task: FulfillmentTask; success: boolean }> {
        // Step 1: Create audit log first
        const success = await this.logAction(
            operatorId,
            taskId,
            actionType,
            oldValue,
            newValue,
            details
        );

        // Step 2: Apply task update
        try {
            const record = await base(TASKS_TABLE).update(taskId, taskUpdate);
            const updatedTask = await this.mapTaskRecord(record);

            console.log(`✅ Atomic operation completed: ${actionType} on task ${taskId}`);
            return { task: updatedTask, success };

        } catch (error) {
            // Task update failed - audit log exists but that's OK for data integrity
            console.warn(`⚠️ Task update failed but audit log is recorded for ${actionType} on task ${taskId}`);
            console.error('Task update error:', error);
            throw new Error(`Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // MARK: - Timestamp-based Operations

    // MARK: - Helper Methods

    private async getOperatorFromStaffId(staffId: string): Promise<StaffMember | undefined> {
        try {
            // Find staff record by staff_id field value
            const records = await base(STAFF_TABLE)
                .select({
                    filterByFormula: `{staff_id} = '${staffId}'`
                })
                .all();

            if (records.length > 0) {
                const record = records[0];
                return {
                    id: record.get('staff_id') as string, // Return staff_id instead of record ID
                    name: record.get('name') as string
                };
            }
        } catch (error) {
            console.error('Error fetching operator from staff_id:', error);
        }
        return undefined;
    }

    // MARK: - Dashboard Helper

    async getTasksGroupedByStatus(): Promise<{
        pending: FulfillmentTask[];
        picking: FulfillmentTask[];
        packed: FulfillmentTask[];
        inspecting: FulfillmentTask[];
        correctionNeeded: FulfillmentTask[];
        correcting: FulfillmentTask[];
        completed: FulfillmentTask[];
        paused: FulfillmentTask[];
        cancelled: FulfillmentTask[];
    }> {
        const allTasks = await this.getAllTasks();

        return {
            pending: allTasks.filter(task => task.status === TaskStatus.PENDING && !task.isPaused),
            picking: allTasks.filter(task => task.status === TaskStatus.PICKING && !task.isPaused),
            packed: allTasks.filter(task => task.status === TaskStatus.PACKED && !task.isPaused),
            inspecting: allTasks.filter(task => task.status === TaskStatus.INSPECTING && !task.isPaused),
            correctionNeeded: allTasks.filter(task => task.status === TaskStatus.CORRECTION_NEEDED && !task.isPaused),
            correcting: allTasks.filter(task => task.status === TaskStatus.CORRECTING && !task.isPaused),
            completed: allTasks.filter(task => task.status === TaskStatus.COMPLETED),
            paused: allTasks.filter(task => task.isPaused === true),
            cancelled: allTasks.filter(task => task.status === TaskStatus.CANCELLED)
        };
    }

    async getTasksGroupedByStatusOptimized(): Promise<{
        grouped: {
            pending: FulfillmentTask[];
            picking: FulfillmentTask[];
            packed: FulfillmentTask[];
            inspecting: FulfillmentTask[];
            correctionNeeded: FulfillmentTask[];
            correcting: FulfillmentTask[];
            completed: FulfillmentTask[];
            paused: FulfillmentTask[];
            cancelled: FulfillmentTask[];
        },
        lastModified: string
    }> {
        const { tasks, lastModified } = await this.getAllTasksOptimized();

        const grouped = {
            pending: tasks.filter(task => task.status === TaskStatus.PENDING && !task.isPaused),
            picking: tasks.filter(task => task.status === TaskStatus.PICKING && !task.isPaused),
            packed: tasks.filter(task => task.status === TaskStatus.PACKED && !task.isPaused),
            inspecting: tasks.filter(task => task.status === TaskStatus.INSPECTING && !task.isPaused),
            correctionNeeded: tasks.filter(task => task.status === TaskStatus.CORRECTION_NEEDED && !task.isPaused),
            correcting: tasks.filter(task => task.status === TaskStatus.CORRECTING && !task.isPaused),
            completed: tasks.filter(task => task.status === TaskStatus.COMPLETED),
            paused: tasks.filter(task => task.isPaused === true),
            cancelled: tasks.filter(task => task.status === TaskStatus.CANCELLED)
        };

        return { grouped, lastModified };
    }
}

// Export singleton instance
export const airtableService = new AirtableService();