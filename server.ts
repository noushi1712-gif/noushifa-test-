import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { civicStore } from './server/civicStore.js';
import type { IssueStatus } from './src/types/civic.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Allow large photo payload uploads from mobile cameras
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Ensure upload directory exists
const UPLOADS_DIR = path.resolve(__dirname, 'public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// API Routes

// 1. Get statistics
app.get('/api/stats', (_req: Request, res: Response) => {
  try {
    const stats = civicStore.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
  }
});

// 2. Get users for switching / authentication
app.get('/api/users', (_req: Request, res: Response) => {
  try {
    const users = civicStore.getUsers();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

// 3. Get reports with search and filter
app.get('/api/reports', (req: Request, res: Response) => {
  try {
    const { category, status, search, userId, sort } = req.query;
    const reports = civicStore.getReports({
      category: category as string,
      status: status as string,
      search: search as string,
      userId: userId as string,
      sort: sort as 'newest' | 'supporters' | 'oldest',
    });
    res.json(reports);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch reports' });
  }
});

// 4. Get single report details
app.get('/api/reports/:id', (req: Request, res: Response) => {
  try {
    const report = civicStore.getReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch report' });
  }
});

// 5. Check potential duplicate issues
app.post('/api/check-duplicates', (req: Request, res: Response) => {
  try {
    const { title, category, latitude, longitude, excludeId } = req.body;
    if (!title || !category || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Missing required parameters for duplicate detection' });
    }

    const result = civicStore.checkDuplicates({
      title: String(title),
      category: String(category),
      latitude: Number(latitude),
      longitude: Number(longitude),
      excludeId: excludeId ? String(excludeId) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Duplicate check failed' });
  }
});

// 6. Submit a new civic issue report
app.post('/api/reports', (req: Request, res: Response) => {
  try {
    const {
      userId,
      userName,
      userEmail,
      title,
      description,
      category,
      imageUrl,
      location,
      latitude,
      longitude,
    } = req.body;

    // Validation
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Issue title is required' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Detailed description is required' });
    }
    if (!category) {
      return res.status(400).json({ error: 'Category selection is required' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'Location description is required' });
    }
    if (latitude === undefined || longitude === undefined || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required' });
    }
    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({ error: 'Photograph upload is required for verification' });
    }

    const created = civicStore.createReport({
      userId: userId || 'user_citizen_01',
      userName: userName || 'Elena Rostova',
      userEmail: userEmail || 'elena.rostova@gmail.com',
      title: title.trim(),
      description: description.trim(),
      category,
      imageUrl,
      location: location.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
    });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to submit report' });
  }
});

// 7. Toggle support / upvote on a report
app.post('/api/reports/:id/support', (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required to support an issue' });
    }

    const result = civicStore.toggleSupport(req.params.id, userId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to toggle support' });
  }
});

// 8. Get list of report IDs supported by the user
app.get('/api/users/:id/supports', (req: Request, res: Response) => {
  try {
    const list = civicStore.getUserSupports(req.params.id);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch user supports' });
  }
});

// 9. Administrator: Update report status
app.patch('/api/reports/:id/status', (req: Request, res: Response) => {
  try {
    const { status, adminNotes, adminUserId, assignedDepartment } = req.body;
    if (!status || !['Pending', 'In Progress', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Valid status (Pending, In Progress, Resolved) is required' });
    }

    const adminUser = civicStore.getUserById(adminUserId || 'user_admin_01');
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Only designated administrators may change report status' });
    }

    const updated = civicStore.updateReportStatus(
      req.params.id,
      status as IssueStatus,
      adminNotes || '',
      adminUser,
      assignedDepartment
    );

    if (!updated) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update report status' });
  }
});

// 10. Administrator: Link as duplicate
app.post('/api/reports/:id/link-duplicate', (req: Request, res: Response) => {
  try {
    const { duplicateOfId, adminUserId } = req.body;
    if (!duplicateOfId) {
      return res.status(400).json({ error: 'duplicateOfId is required' });
    }

    const adminUser = civicStore.getUserById(adminUserId || 'user_admin_01');
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Only administrators can link duplicate reports' });
    }

    const updated = civicStore.linkDuplicateReport(req.params.id, duplicateOfId, adminUser);
    if (!updated) {
      return res.status(404).json({ error: 'Report or target duplicate not found' });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to link duplicate' });
  }
});

// 11. Image upload endpoint (stores base64 or saves locally)
app.post('/api/upload', (req: Request, res: Response) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    // If already a generated path or standard url
    if (dataUrl.startsWith('/src/assets') || dataUrl.startsWith('http')) {
      return res.json({ url: dataUrl });
    }

    // Save base64 image data to /public/uploads
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      // Fallback: return as data URL directly if format is custom
      return res.json({ url: dataUrl });
    }

    const ext = matches[1].split('/')[1] || 'jpeg';
    const cleanExt = ext === 'jpeg' ? 'jpg' : ext.replace(/[^a-z0-9]/gi, '');
    const cleanFilename = `report_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${cleanExt}`;
    const filePath = path.join(UPLOADS_DIR, cleanFilename);

    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(filePath, buffer);

    res.json({ url: `/uploads/${cleanFilename}` });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// 12. Reset demo data endpoint
app.post('/api/reset-demo', (_req: Request, res: Response) => {
  try {
    civicStore.resetDemoData();
    res.json({ success: true, message: 'Database reset to initial sample set' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reset demo data' });
  }
});

// Vite middleware in dev or static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CivicConnect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server boot error:', err);
  process.exit(1);
});
