import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import dashboardRoutes from './routes/dashboard';
import taskRoutes from './routes/tasks';
import staffRoutes from './routes/staff';
import issueRoutes from './routes/issues';
import auditLogRoutes from './routes/audit-logs';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

// Error handling
app.use(errorHandler);

app.listen(PORT, "0.0.0.0",() => {
    console.log(`CapiCar API server running on http://0.0.0.0:${PORT}`);
});