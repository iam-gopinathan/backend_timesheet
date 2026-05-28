const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const STATUS_LABEL = {
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'In Review',
  done: 'Done',
};

const PRIORITY_LABEL = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  highest: 'Highest',
};

const STATUS_FILL = {
  todo: 'FFE9ECEF',
  in_progress: 'FFE3F0FF',
  review: 'FFF7E6E6',
  done: 'FFE3F8E8',
};

const formatDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const parseDate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

router.get('/tasks.xlsx', authenticate, async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    let query = `
      SELECT t.id,
             w.project_code, t.issue_number,
             t.title, t.description,
             t.status, t.priority,
             u.name AS assignee_name,
             w.name AS workspace_name,
             ab.name AS assigned_by_name,
             t.estimated_hours, t.logged_hours,
             t.deadline, t.created_at, t.completed_at
      FROM tasks t
      LEFT JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users ab ON t.assigned_by_id = ab.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'employee') {
      query += ' AND t.assignee_id = ?';
      params.push(req.user.id);
    } else if (req.user.role === 'team_lead') {
      query += ' AND t.assignee_id IN (SELECT id FROM users WHERE team_id = ?)';
      params.push(req.user.team_id);
    }

    if (from) {
      query += ' AND DATE(t.created_at) >= ?';
      params.push(from);
    }
    if (to) {
      query += ' AND DATE(t.created_at) <= ?';
      params.push(to);
    }

    query += ' ORDER BY w.project_code, t.issue_number';

    const [rows] = await pool.query(query, params);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ara Timesheet';
    workbook.created = new Date();

    const sheetName =
      from && to
        ? 'Tasks ' + from + ' to ' + to
        : from
          ? 'Tasks since ' + from
          : to
            ? 'Tasks until ' + to
            : 'All Tasks';
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Issue Key', key: 'issueKey', width: 14 },
      { header: 'Title', key: 'title', width: 42 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Assignee', key: 'assignee', width: 22 },
      { header: 'Workspace', key: 'workspace', width: 22 },
      { header: 'Assigned By', key: 'assignedBy', width: 22 },
      { header: 'Estimated (h)', key: 'estimated', width: 14 },
      { header: 'Logged (h)', key: 'logged', width: 12 },
      { header: 'Deadline', key: 'deadline', width: 14 },
      { header: 'Created', key: 'created', width: 14 },
      { header: 'Completed', key: 'completed', width: 14 },
      { header: 'Description', key: 'description', width: 60 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0052CC' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height = 22;

    rows.forEach((t) => {
      const row = sheet.addRow({
        issueKey: t.project_code && t.issue_number ? t.project_code + '-' + t.issue_number : '',
        title: t.title,
        status: STATUS_LABEL[t.status] || t.status,
        priority: PRIORITY_LABEL[t.priority] || t.priority,
        assignee: t.assignee_name || '',
        workspace: t.workspace_name || '',
        assignedBy: t.assigned_by_name || '',
        estimated: Number(t.estimated_hours) || 0,
        logged: Number(t.logged_hours) || 0,
        deadline: formatDate(t.deadline),
        created: formatDate(t.created_at),
        completed: formatDate(t.completed_at),
        description: t.description || '',
      });

      const fill = STATUS_FILL[t.status];
      if (fill) {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      }
      row.alignment = { vertical: 'top', wrapText: true };
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };

    const filenameSuffix =
      from && to ? from + '_to_' + to : from ? 'from-' + from : to ? 'until-' + to : formatDate(new Date());
    const filename = 'ara-tasks-' + filenameSuffix + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export tasks error:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Error exporting tasks: ' + error.message });
  }
});

module.exports = router;
