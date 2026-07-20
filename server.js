const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

// ===== مقداردهی دیتابیس =====
async function initDB() {
  db = await open({
    filename: path.join(__dirname, 'office.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      personnelNumber TEXT UNIQUE,
      nationalCode TEXT UNIQUE,
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      birthDate TEXT,
      address TEXT,
      notes TEXT,
      enrollDate TEXT,
      receiveSms INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS periods (
      id TEXT PRIMARY KEY,
      name TEXT,
      startDate TEXT,
      endDate TEXT
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      periodId TEXT,
      className TEXT,
      teacher TEXT,
      capacity INTEGER,
      tuitionFee INTEGER,
      allowedRoles TEXT,
      schedule TEXT
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      classId TEXT,
      totalAmount INTEGER,
      discountPercent INTEGER,
      discountAmount INTEGER,
      finalAmount INTEGER,
      payments TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      studentId TEXT,
      classId TEXT,
      eventId TEXT,
      amount INTEGER,
      method TEXT,
      date TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      classId TEXT,
      studentId TEXT,
      date TEXT,
      status TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT,
      role TEXT,
      schoolId TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT,
      date TEXT,
      location TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      phone TEXT,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS teacherSettings (
      teacher TEXT PRIMARY KEY,
      sharePercent INTEGER
    );
  `);

  // کاربر ادمین پیش‌فرض
  const admin = await db.get('SELECT * FROM users WHERE username = ?', 'admin');
  if (!admin) {
    const hashed = await bcrypt.hash('123456', 10);
    await db.run('INSERT INTO users (username, password, role, schoolId) VALUES (?, ?, ?, ?)',
      'admin', hashed, 'admin', 'school1');
    await db.run('INSERT INTO schools (id, name, address, phone, createdAt) VALUES (?, ?, ?, ?, ?)',
      'school1', 'آموزشگاه اصلی', '', '', new Date().toISOString());
    
    // داده‌های نمونه
    await db.run(`
      INSERT INTO students (id, personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, enrollDate, receiveSms)
      VALUES 
        ('s1', 'P000001', '1234567890', 'احمد', 'رضایی', '09123456789', '2010-05-12', 'تهران', '2025-01-10', 1),
        ('s2', 'P000002', '0987654321', 'سارا', 'محمدی', '09129876543', '2011-08-23', 'اصفهان', '2025-01-15', 0)
    `);
    await db.run(`
      INSERT INTO periods (id, name, startDate, endDate)
      VALUES 
        ('p1', 'دوره بهار ۱۴۰۴', '1404/01/01', '1404/03/31'),
        ('p2', 'دوره تابستان ۱۴۰۴', '1404/04/01', '1404/06/31')
    `);
    await db.run(`
      INSERT INTO classes (id, periodId, className, teacher, capacity, tuitionFee, schedule)
      VALUES
        ('c1', 'p1', 'مکالمه زبان انگلیسی', 'خانم کریمی', 15, 150000, '{"days":["sat"],"time":"10:00-12:00"}'),
        ('c2', 'p1', 'شطرنج مقدماتی', 'آقای حسینی', 10, 120000, '{"days":["sun"],"time":"14:00-16:00"}'),
        ('c3', 'p2', 'خوشنویسی', 'استاد رضوی', 12, 180000, '{"days":["tue"],"time":"16:00-18:00"}')
    `);
  }
}

// ===== میدلور احراز هویت =====
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'نیاز به ورود' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, 'secretkey');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'توکن نامعتبر' });
  }
}

// ===== مسیر لاگین =====
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE username = ?', username);
  if (!user) return res.status(401).json({ error: 'کاربر یافت نشد' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  const token = jwt.sign({ username, role: user.role, schoolId: user.schoolId }, 'secretkey', { expiresIn: '7d' });
  res.json({ token, role: user.role, schoolId: user.schoolId });
});

// ===== مسیر دانش‌آموزان =====
app.get('/api/students', auth, async (req, res) => {
  const rows = await db.all('SELECT * FROM students');
  res.json(rows);
});

app.post('/api/students', auth, async (req, res) => {
  const { personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, notes, receiveSms } = req.body;
  const id = uuidv4();
  await db.run(
    `INSERT INTO students (id, personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, notes, enrollDate, receiveSms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, notes, new Date().toISOString().split('T')[0], receiveSms ? 1 : 0
  );
  const newStudent = await db.get('SELECT * FROM students WHERE id = ?', id);
  res.status(201).json(newStudent);
});

app.put('/api/students/:id', auth, async (req, res) => {
  const { personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, notes, receiveSms } = req.body;
  await db.run(
    `UPDATE students SET personnelNumber=?, nationalCode=?, firstName=?, lastName=?, phone=?, birthDate=?, address=?, notes=?, receiveSms=?
     WHERE id = ?`,
    personnelNumber, nationalCode, firstName, lastName, phone, birthDate, address, notes, receiveSms ? 1 : 0, req.params.id
  );
  const updated = await db.get('SELECT * FROM students WHERE id = ?', req.params.id);
  res.json(updated);
});

app.delete('/api/students/:id', auth, async (req, res) => {
  await db.run('DELETE FROM students WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر دوره‌ها =====
app.get('/api/periods', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM periods'));
});

app.post('/api/periods', auth, async (req, res) => {
  const { name, startDate, endDate } = req.body;
  const id = uuidv4();
  await db.run('INSERT INTO periods (id, name, startDate, endDate) VALUES (?, ?, ?, ?)', id, name, startDate, endDate);
  res.status(201).json(await db.get('SELECT * FROM periods WHERE id = ?', id));
});

app.put('/api/periods/:id', auth, async (req, res) => {
  const { name, startDate, endDate } = req.body;
  await db.run('UPDATE periods SET name=?, startDate=?, endDate=? WHERE id=?', name, startDate, endDate, req.params.id);
  res.json(await db.get('SELECT * FROM periods WHERE id = ?', req.params.id));
});

app.delete('/api/periods/:id', auth, async (req, res) => {
  await db.run('DELETE FROM periods WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر کلاس‌ها =====
app.get('/api/classes', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM classes'));
});

app.post('/api/classes', auth, async (req, res) => {
  const { periodId, className, teacher, capacity, tuitionFee, allowedRoles, schedule } = req.body;
  const id = uuidv4();
  await db.run(
    `INSERT INTO classes (id, periodId, className, teacher, capacity, tuitionFee, allowedRoles, schedule)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, periodId, className, teacher, capacity, tuitionFee, JSON.stringify(allowedRoles), JSON.stringify(schedule)
  );
  res.status(201).json(await db.get('SELECT * FROM classes WHERE id = ?', id));
});

app.put('/api/classes/:id', auth, async (req, res) => {
  const { periodId, className, teacher, capacity, tuitionFee, allowedRoles, schedule } = req.body;
  await db.run(
    `UPDATE classes SET periodId=?, className=?, teacher=?, capacity=?, tuitionFee=?, allowedRoles=?, schedule=?
     WHERE id=?`,
    periodId, className, teacher, capacity, tuitionFee, JSON.stringify(allowedRoles), JSON.stringify(schedule), req.params.id
  );
  res.json(await db.get('SELECT * FROM classes WHERE id = ?', req.params.id));
});

app.delete('/api/classes/:id', auth, async (req, res) => {
  await db.run('DELETE FROM classes WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر ثبت‌نام =====
app.get('/api/enrollments', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM enrollments'));
});

app.post('/api/enrollments', auth, async (req, res) => {
  const { studentId, classId, totalAmount, discountPercent, discountAmount, finalAmount, payments } = req.body;
  const id = uuidv4();
  await db.run(
    `INSERT INTO enrollments (id, studentId, classId, totalAmount, discountPercent, discountAmount, finalAmount, payments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, studentId, classId, totalAmount, discountPercent, discountAmount, finalAmount, JSON.stringify(payments || [])
  );
  res.status(201).json(await db.get('SELECT * FROM enrollments WHERE id = ?', id));
});

app.delete('/api/enrollments/:id', auth, async (req, res) => {
  await db.run('DELETE FROM enrollments WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر تراکنش‌ها =====
app.get('/api/transactions', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM transactions'));
});

app.post('/api/transactions', auth, async (req, res) => {
  const { studentId, classId, eventId, amount, method, date, description } = req.body;
  const id = uuidv4();
  await db.run(
    `INSERT INTO transactions (id, studentId, classId, eventId, amount, method, date, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, studentId, classId, eventId, amount, method, date, description
  );
  res.status(201).json(await db.get('SELECT * FROM transactions WHERE id = ?', id));
});

app.delete('/api/transactions/:id', auth, async (req, res) => {
  await db.run('DELETE FROM transactions WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر حضور و غیاب =====
app.get('/api/attendance', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM attendance'));
});

app.post('/api/attendance', auth, async (req, res) => {
  const { classId, studentId, date, status, note } = req.body;
  const id = uuidv4();
  await db.run(
    `INSERT INTO attendance (id, classId, studentId, date, status, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, classId, studentId, date, status, note
  );
  res.status(201).json(await db.get('SELECT * FROM attendance WHERE id = ?', id));
});

// ===== مسیر کاربران =====
app.get('/api/users', auth, async (req, res) => {
  const rows = await db.all('SELECT username, role, schoolId FROM users');
  res.json(rows);
});

app.post('/api/users', auth, async (req, res) => {
  const { username, password, role, schoolId } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  await db.run('INSERT INTO users (username, password, role, schoolId) VALUES (?, ?, ?, ?)',
    username, hashed, role, schoolId);
  res.status(201).json({ username, role, schoolId });
});

app.put('/api/users/:username', auth, async (req, res) => {
  const { password, role, schoolId } = req.body;
  let query = 'UPDATE users SET role=?, schoolId=?';
  let params = [role, schoolId];
  if (password) {
    const hashed = await bcrypt.hash(password, 10);
    query = 'UPDATE users SET password=?, role=?, schoolId=?';
    params = [hashed, role, schoolId];
  }
  params.push(req.params.username);
  await db.run(query, params);
  res.json({ username: req.params.username, role, schoolId });
});

app.delete('/api/users/:username', auth, async (req, res) => {
  await db.run('DELETE FROM users WHERE username = ?', req.params.username);
  res.status(204).send();
});

// ===== مسیر تنظیمات =====
app.get('/api/settings', auth, async (req, res) => {
  const rows = await db.all('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', auth, async (req, res) => {
  const settings = req.body;
  for (const key in settings) {
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, settings[key]);
  }
  res.json(settings);
});

// ===== مسیر آموزشگاه‌ها =====
app.get('/api/schools', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM schools'));
});

app.post('/api/schools', auth, async (req, res) => {
  const { name, address, phone } = req.body;
  const id = uuidv4();
  await db.run('INSERT INTO schools (id, name, address, phone, createdAt) VALUES (?, ?, ?, ?, ?)',
    id, name, address, phone, new Date().toISOString());
  res.status(201).json(await db.get('SELECT * FROM schools WHERE id = ?', id));
});

// ===== مسیر رویدادها =====
app.get('/api/events', auth, async (req, res) => {
  res.json(await db.all('SELECT * FROM events'));
});

app.post('/api/events', auth, async (req, res) => {
  const { title, type, date, location, description } = req.body;
  const id = uuidv4();
  await db.run(
    'INSERT INTO events (id, title, type, date, location, description) VALUES (?, ?, ?, ?, ?, ?)',
    id, title, type, date, location, description
  );
  res.status(201).json(await db.get('SELECT * FROM events WHERE id = ?', id));
});

app.delete('/api/events/:id', auth, async (req, res) => {
  await db.run('DELETE FROM events WHERE id = ?', req.params.id);
  res.status(204).send();
});

// ===== مسیر مدرسان =====
app.get('/api/teachers', auth, async (req, res) => {
  const classes = await db.all('SELECT * FROM classes');
  const enrolls = await db.all('SELECT * FROM enrollments');
  const attendance = await db.all('SELECT * FROM attendance');
  const teacherSettings = await db.all('SELECT * FROM teacherSettings');
  
  const teacherMap = {};
  for (const cls of classes) {
    const teacher = cls.teacher || 'بدون مدرس';
    if (!teacherMap[teacher]) teacherMap[teacher] = { classes: 0, students: 0, sessions: 0, absences: 0, income: 0, sharePercent: 50 };
    teacherMap[teacher].classes++;
    const studentIds = new Set();
    for (const en of enrolls) {
      if (en.classId === cls.id) {
        studentIds.add(en.studentId);
        teacherMap[teacher].income += en.finalAmount || en.totalAmount || 0;
      }
    }
    teacherMap[teacher].students += studentIds.size;
    const classAttendance = attendance.filter(a => a.classId === cls.id);
    const sessionDates = new Set(classAttendance.map(a => a.date));
    teacherMap[teacher].sessions += sessionDates.size;
    teacherMap[teacher].absences += classAttendance.filter(a => a.status === 'absent').length;
  }
  for (const ts of teacherSettings) {
    if (teacherMap[ts.teacher]) teacherMap[ts.teacher].sharePercent = ts.sharePercent;
  }
  const result = Object.keys(teacherMap).map(t => ({
    teacher: t,
    ...teacherMap[t],
    salary: Math.round((teacherMap[t].income * teacherMap[t].sharePercent) / 100)
  }));
  res.json(result);
});

app.post('/api/teachers/settings', auth, async (req, res) => {
  const { teacher, sharePercent } = req.body;
  await db.run('INSERT OR REPLACE INTO teacherSettings (teacher, sharePercent) VALUES (?, ?)', teacher, sharePercent);
  res.json({ teacher, sharePercent });
});

// ===== راه‌اندازی سرور =====
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ سرور روی پورت ${PORT} اجرا شد`);
  });
}).catch(err => {
  console.error('❌ خطا در راه‌اندازی دیتابیس:', err);
});
