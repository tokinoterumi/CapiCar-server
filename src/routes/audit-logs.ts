import express from 'express';
import { airtableService } from '../services/airtableService';

const router = express.Router();

// POST /api/audit-logs/sync
// Accept audit logs from iOS clients and store them in the Airtable Audit_Log table
router.post('/sync', async (req, res) => {
    try {
        const { logs } = req.body;

        if (!logs || !Array.isArray(logs)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: logs array is required'
            });
        }

        console.log(`📝 AUDIT LOG SYNC: Received ${logs.length} audit log entries`);

        let syncedCount = 0;
        const errors: any[] = [];

        // Process each audit log entry
        for (const log of logs) {
            try {
                const {
                    timestamp,
                    action_type,
                    staff_id,
                    task_id,
                    old_value,
                    new_value,
                    details
                } = log;

                // Validate required fields
                if (!timestamp || !action_type || !staff_id || !task_id) {
                    errors.push({
                        log: log,
                        error: 'Missing required fields: timestamp, action_type, staff_id, task_id'
                    });
                    continue;
                }

                // Call the existing logAction method but with the client-provided timestamp
                const success = await airtableService.logAction(
                    staff_id,
                    task_id,
                    action_type,
                    old_value || '',
                    new_value || '',
                    details || '',
                    timestamp // Pass the client timestamp
                );

                if (success) {
                    syncedCount++;
                    console.log(`📝 Synced audit log: ${action_type} for task ${task_id}`);
                } else {
                    // logAction returned false, indicating failure
                    console.warn(`⚠️ Failed to sync audit log: ${action_type} for task ${task_id}`);
                    errors.push({
                        log: log,
                        error: 'Audit log creation failed'
                    });
                }

            } catch (error) {
                console.error(`Error syncing audit log:`, error);
                errors.push({
                    log: log,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        if (errors.length > 0) {
            console.warn(`⚠️ AUDIT LOG SYNC: Synced ${syncedCount}/${logs.length} entries with ${errors.length} errors`);
        } else {
            console.log(`✅ AUDIT LOG SYNC: Successfully synced ${syncedCount}/${logs.length} entries`);
        }

        res.json({
            success: syncedCount > 0, // Only consider it fully successful if at least one log was synced
            synced_count: syncedCount,
            total_logs: logs.length,
            errors: errors,
            message: errors.length > 0
                ? `Synced ${syncedCount}/${logs.length} audit logs with ${errors.length} errors`
                : `Successfully synced all ${syncedCount} audit logs`
        });

    } catch (error) {
        console.error('Audit log sync error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync audit logs',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;