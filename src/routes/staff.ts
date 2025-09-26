import express from 'express';
import { airtableService } from '../services/airtableService';

const router = express.Router();

// GET /api/staff
// Get all staff members for operator selection (optimized with caching)
router.get('/', async (req, res) => {
    try {
        // Always fetch fresh staff data - no ETag caching complexity
        const { staff, lastModified } = await airtableService.getAllStaffOptimized();

        // Set no-cache headers for reliable fresh data
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Add timestamp headers for debugging
        res.setHeader('X-Server-Timestamp', new Date().toISOString());
        res.setHeader('X-Staff-Generated', lastModified);

        res.json({
            success: true,
            data: staff
        });

    } catch (error) {
        console.error('Get staff error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch staff',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// GET /api/staff/:id
// Get specific staff member details
router.get('/:id', async (req, res) => {
    try {
        const staffId = req.params.id;
        const staff = await airtableService.getStaffById(staffId);

        if (!staff) {
            return res.status(404).json({
                success: false,
                error: 'Staff member not found'
            });
        }

        res.json({
            success: true,
            data: staff
        });

    } catch (error) {
        console.error('Get staff member error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch staff member',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// POST /api/staff/checkin
// Handle operator check-in for shift management
router.post('/checkin', async (req, res) => {
    try {
        const { staffId, action } = req.body;

        if (!staffId || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: staffId and action'
            });
        }

        // Verify staff member exists
        const staff = await airtableService.getStaffById(staffId);
        if (!staff) {
            return res.status(404).json({
                success: false,
                error: 'Staff member not found'
            });
        }

        const currentTime = new Date().toISOString();

        switch (action) {
            case 'CHECK_IN':
                // Check-in logging removed - attendance tracking is not task workflow
                res.json({
                    success: true,
                    data: {
                        staff: staff,
                        action: 'CHECK_IN',
                        timestamp: currentTime,
                        message: `${staff.name} checked in successfully`
                    }
                });
                break;

            case 'CHECK_OUT':
                // Check-out logging removed - attendance tracking is not task workflow
                res.json({
                    success: true,
                    data: {
                        staff: staff,
                        action: 'CHECK_OUT',
                        timestamp: currentTime,
                        message: `${staff.name} checked out successfully`
                    }
                });
                break;

            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown check-in action: ${action}`
                });
        }

    } catch (error) {
        console.error('Staff check-in error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process check-in',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// POST /api/staff
// Create a new staff member
router.post('/', async (req, res) => {
    try {
        const { name, staff_id } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Staff name is required'
            });
        }

        const newStaff = await airtableService.createStaff(name, staff_id);

        res.status(201).json({
            success: true,
            data: newStaff
        });

    } catch (error) {
        console.error('Create staff error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create staff member',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// PUT /api/staff/:id
// Update an existing staff member
router.put('/:id', async (req, res) => {
    try {
        const staffId = req.params.id;
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Staff name is required'
            });
        }

        const updatedStaff = await airtableService.updateStaff(staffId, name);

        if (!updatedStaff) {
            return res.status(404).json({
                success: false,
                error: 'Staff member not found'
            });
        }

        res.json({
            success: true,
            data: updatedStaff
        });

    } catch (error) {
        console.error('Update staff error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update staff member',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// DELETE /api/staff/:id
// Delete a staff member
router.delete('/:id', async (req, res) => {
    try {
        const staffId = req.params.id;

        const success = await airtableService.deleteStaff(staffId);

        if (!success) {
            return res.status(404).json({
                success: false,
                error: 'Staff member not found'
            });
        }

        res.json({
            success: true,
            message: 'Staff member deleted successfully'
        });

    } catch (error) {
        console.error('Delete staff error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete staff member',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;