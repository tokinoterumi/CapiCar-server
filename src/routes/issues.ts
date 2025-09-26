import express from 'express';
import { airtableService } from '../services/airtableService';

const router = express.Router();

// POST /api/issues/report
// Report an issue with detailed logging
router.post('/report', async (req, res) => {
    try {
        const {
            task_id,
            operator_id,
            operator_name,
            issue_type,
            description,
            timestamp,
            task_status,
            order_name
        } = req.body;

        console.log('DEBUG: Issue report request body:', JSON.stringify(req.body, null, 2));

        // Validate required fields
        if (!task_id || !operator_id || !issue_type || !description) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: task_id, operator_id, issue_type, and description are required'
            });
        }

        // Move task to exception pool and update status
        await airtableService.moveTaskToExceptionPool(
            task_id,
            issue_type,
            description,
            operator_id
        );

        // Log the issue in the audit log with detailed information
        const issueDetails = `📝 詳細記録 / Detailed Issue Report
Issue Type: ${issue_type}
Description: ${description}
Task Status: ${task_status}
Order: ${order_name}
Timestamp: ${timestamp}
Operator: ${operator_name} (${operator_id})
⚠️ Task moved to exception pool for resolution`;

        await airtableService.logAction(
            operator_id,
            task_id,
            'REPORT_ISSUE',
            task_status,
            'pending',
            issueDetails
        );

        console.log(`✅ Issue reported and task ${task_id} moved to exception pool by ${operator_name}`);

        res.json({
            success: true,
            message: 'Issue reported successfully and logged for review'
        });

    } catch (error) {
        console.error('Issue report error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to report issue',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;