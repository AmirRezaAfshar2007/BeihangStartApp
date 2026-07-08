import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createServer as createViteServer } from 'vite';
import { getDb, saveDb } from './src/db.ts';
import { parseHanziWithSino3D } from './src/gemini.ts';
import { Student, CharacterItem, PracticeLog, StudentStats, Achievement, UserSession } from './src/types.ts';

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sino3d-enterprise-secret-key-2026';

app.use(express.json());

// --- Authentication Middleware ---
export interface AuthRequest extends Request {
  user?: {
    id: string;
    studentId: string;
    fullName: string;
    role: 'admin' | 'student';
  };
}

const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      studentId: string;
      fullName: string;
      role: 'admin' | 'student';
    };
    req.user = decoded;
    
    const db = getDb();
    // Double check if account is disabled
    const student = db.students.find(s => s.studentId === decoded.studentId);
    if (student && student.disabled) {
      return res.status(403).json({ error: 'Forbidden: Account is disabled by Admin.' });
    }

    // Verify active session on server to prevent unauthorized access after logout
    const session = db.sessions?.find(s => s.token === token);
    if (!session || new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Unauthorized: Session invalidated or expired.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  });
};

// --- AUTHENTICATION ENDPOINTS ---

// Register
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { studentId, fullName, password } = req.body;

  if (!studentId || !fullName || !password) {
    return res.status(400).json({ error: 'Student ID, Full Name, and Password are required.' });
  }

  // Enforce Student ID format (must be numeric, at least 5 digits)
  if (!/^\d{5,15}$/.test(studentId)) {
    return res.status(400).json({ error: 'Invalid Student ID format. Must be numeric (e.g., 401120145).' });
  }

  const db = getDb();
  const exists = db.students.some(s => s.studentId === studentId);
  if (exists) {
    return res.status(400).json({ error: 'Student ID is already registered.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const newStudent: Student = {
    id: `student-${Date.now()}`,
    studentId,
    fullName,
    passwordHash,
    role: 'student',
    disabled: false,
    createdAt: new Date().toISOString(),
  };

  db.students.push(newStudent);

  // Initialize stats for the new student
  const defaultStats: StudentStats = {
    studentId,
    currentStreak: 0,
    totalXp: 0,
    studyTimeSeconds: 0,
    lastActiveDate: null,
  };
  db.stats.push(defaultStats);

  // Initialize introductory achievement
  const introAchievement: Achievement = {
    id: `ach-${Date.now()}`,
    studentId,
    title: 'First Step',
    description: 'Logged in to Sino3D Chinese Calligraphy platform.',
    unlockedAt: new Date().toISOString(),
    icon: '🚀',
  };
  db.achievements.push(introAchievement);

  saveDb(db);

  const token = jwt.sign(
    { id: newStudent.id, studentId: newStudent.studentId, fullName: newStudent.fullName, role: newStudent.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Record active session
  if (!db.sessions) db.sessions = [];
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.sessions.push({
    token,
    studentId: newStudent.studentId,
    expiresAt,
  });
  saveDb(db);

  res.status(201).json({
    token,
    user: {
      studentId: newStudent.studentId,
      fullName: newStudent.fullName,
      role: newStudent.role,
    }
  });
});

// Login
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { studentId, password } = req.body;

  if (!studentId || !password) {
    return res.status(400).json({ error: 'Student ID and Password are required.' });
  }

  const db = getDb();
  const student = db.students.find(s => s.studentId === studentId);

  if (!student) {
    return res.status(401).json({ error: 'Invalid Student ID or password.' });
  }

  if (student.disabled) {
    return res.status(403).json({ error: 'Your student account has been disabled by the Administrator.' });
  }

  const isMatch = bcrypt.compareSync(password, student.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid Student ID or password.' });
  }

  // Update study stats active date
  const statsIndex = db.stats.findIndex(s => s.studentId === studentId);
  const todayStr = new Date().toISOString().split('T')[0];
  if (statsIndex !== -1) {
    const s = db.stats[statsIndex];
    if (s.lastActiveDate !== todayStr) {
      // Check streak continuity
      if (s.lastActiveDate) {
        const lastDate = new Date(s.lastActiveDate);
        const today = new Date(todayStr);
        const diffTime = Math.abs(today.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          s.currentStreak += 1;
        } else if (diffDays > 1) {
          s.currentStreak = 1; // Reset streak
        }
      } else {
        s.currentStreak = 1;
      }
      s.lastActiveDate = todayStr;
      saveDb(db);
    }
  }

  const token = jwt.sign(
    { id: student.id, studentId: student.studentId, fullName: student.fullName, role: student.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Record active session and clean up expired sessions
  if (!db.sessions) db.sessions = [];
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
  
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.sessions.push({
    token,
    studentId: student.studentId,
    expiresAt,
  });
  saveDb(db);

  res.json({
    token,
    user: {
      studentId: student.studentId,
      fullName: student.fullName,
      role: student.role,
    }
  });
});

// Logout and invalidate active session
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const db = getDb();
    if (db.sessions) {
      db.sessions = db.sessions.filter(s => s.token !== token);
      saveDb(db);
    }
  }
  res.json({ success: true, message: 'You have been signed out successfully.' });
});

// Get Me
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json({ user: req.user });
});

// Forgot Password - simplified self-service update
app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
  const { studentId, fullName, newPassword } = req.body;
  if (!studentId || !fullName || !newPassword) {
    return res.status(400).json({ error: 'Student ID, Full Name, and New Password are required for verification.' });
  }

  const db = getDb();
  const student = db.students.find(s => s.studentId === studentId && s.fullName.toLowerCase() === fullName.toLowerCase());
  if (!student) {
    return res.status(404).json({ error: 'Student record with matching Name and ID not found.' });
  }

  const salt = bcrypt.genSaltSync(10);
  student.passwordHash = bcrypt.hashSync(newPassword, salt);
  saveDb(db);

  res.json({ message: 'Password has been successfully updated.' });
});


// --- CHARACTER & LEARNING ENDPOINTS ---

// Get Characters for Logged-In Student
app.get('/api/characters', requireAuth, (req: AuthRequest, res: Response) => {
  const studentId = req.user?.studentId;
  const db = getDb();
  const userChars = db.characters.filter(c => c.studentId === studentId);
  res.json(userChars);
});

// Add New Chinese Character (Queries Sino3D AI Engine)
app.post('/api/characters/add', requireAuth, async (req: AuthRequest, res: Response) => {
  const { character } = req.body;
  const studentId = req.user?.studentId;

  if (!character || character.trim().length !== 1) {
    return res.status(400).json({ error: 'Please enter exactly one Chinese character.' });
  }

  const cleanChar = character.trim();
  const db = getDb();

  // Check if student already has this character added
  const alreadyAdded = db.characters.some(c => c.studentId === studentId && c.character === cleanChar);
  if (alreadyAdded) {
    return res.status(400).json({ error: 'This character is already in your learning deck.' });
  }

  try {
    // Call the server-side Sino3D Lexicon parser
    const dictData = await parseHanziWithSino3D(cleanChar);

    const newCharItem: CharacterItem = {
      id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      studentId: studentId!,
      character: dictData.character,
      simplified: dictData.simplified,
      traditional: dictData.traditional,
      pinyin: dictData.pinyin,
      englishMeaning: dictData.englishMeaning,
      persianMeaning: '',
      radicals: dictData.radicals || [cleanChar],
      strokeCount: dictData.strokeCount || 1,
      hskLevel: dictData.hskLevel || 1,
      frequencyRank: dictData.frequencyRank || 9999,
      exampleWords: dictData.exampleWords || [],
      exampleSentences: dictData.exampleSentences || [],
      audioPronunciation: '', // Filled in client-side via speech synthesis or server TTS
      dateAdded: new Date().toISOString(),
      lastReviewed: null,
      reviewCount: 0,
      learningLevel: 0, // 0 = New
      memoryStability: 10, // Starting decay resistance
      interval: 1, // Start review interval at 1 day
      nextReviewDate: new Date().toISOString().split('T')[0],
    };

    db.characters.push(newCharItem);

    // Give some XP for adding a word
    const statsIndex = db.stats.findIndex(s => s.studentId === studentId);
    if (statsIndex !== -1) {
      db.stats[statsIndex].totalXp += 15;
    }

    saveDb(db);
    res.status(201).json(newCharItem);
  } catch (err) {
    console.error('Failed to parse and insert character:', err);
    res.status(500).json({ error: 'Failed to look up Chinese character properties. Please try again.' });
  }
});

// Delete Character from Student's Deck
app.delete('/api/characters/:charId', requireAuth, (req: AuthRequest, res: Response) => {
  const { charId } = req.params;
  const studentId = req.user?.studentId;

  const db = getDb();
  const index = db.characters.findIndex(c => c.id === charId && c.studentId === studentId);

  if (index === -1) {
    return res.status(404).json({ error: 'Character not found in your learning deck.' });
  }

  db.characters.splice(index, 1);
  saveDb(db);

  res.json({ success: true, message: 'Character successfully removed from your training deck.' });
});


// --- PRACTICE LOG & SRS SM-2 ALGORITHM ENDPOINT ---

app.post('/api/practice/log', requireAuth, (req: AuthRequest, res: Response) => {
  const { characterId, quizMode, score, durationSeconds } = req.body;
  const studentId = req.user?.studentId;

  if (!characterId || !quizMode || score === undefined) {
    return res.status(400).json({ error: 'Missing practice results payload details.' });
  }

  const db = getDb();
  const charItem = db.characters.find(c => c.id === characterId && c.studentId === studentId);
  if (!charItem) {
    return res.status(404).json({ error: 'Character record not found.' });
  }

  // Determine success based on score (>= 70 is passing)
  const isSuccess = score >= 70;

  // --- SM-2 Spaced Repetition Logic ---
  // rating: translate score 0-100 to 0-5 rating scale
  // 90-100 -> 5, 80-89 -> 4, 70-79 -> 3, 50-69 -> 2, 30-49 -> 1, 0-29 -> 0
  let rating = 0;
  if (score >= 90) rating = 5;
  else if (score >= 80) rating = 4;
  else if (score >= 70) rating = 3;
  else if (score >= 50) rating = 2;
  else if (score >= 30) rating = 1;

  charItem.reviewCount += 1;
  charItem.lastReviewed = new Date().toISOString();

  // SM-2 calculations
  let interval = charItem.interval;
  let stability = charItem.memoryStability;
  let level = charItem.learningLevel;

  if (rating >= 3) {
    // Successful recall
    if (level === 0) {
      interval = 1; // 1 day
      level = 1; // Learning
      stability = 40;
    } else if (level === 1) {
      interval = 3; // 3 days
      level = 2; // Familiar
      stability = 65;
    } else {
      interval = Math.min(180, Math.round(charItem.interval * 2.1));
      level = 3; // Mastered
      stability = Math.min(100, Math.round(charItem.memoryStability + 10));
    }
  } else {
    // Incorrect recall (forgotten)
    interval = 1; // reset interval to 1 day
    level = Math.max(0, level - 1);
    stability = Math.max(10, Math.round(charItem.memoryStability - 20));
  }

  charItem.interval = interval;
  charItem.learningLevel = level;
  charItem.memoryStability = stability;

  // Calculate next review date based on calculated interval
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);
  charItem.nextReviewDate = nextReview.toISOString().split('T')[0];

  // Record practice log
  const newLog: PracticeLog = {
    id: `log-${Date.now()}`,
    studentId: studentId!,
    character: charItem.character,
    quizMode,
    success: isSuccess,
    score,
    timestamp: new Date().toISOString()
  };
  db.practiceLogs.push(newLog);

  // Update student stats (XP, study time)
  const stats = db.stats.find(s => s.studentId === studentId);
  const awardXp = isSuccess ? 25 : 10;
  if (stats) {
    stats.totalXp += awardXp;
    if (durationSeconds) {
      stats.studyTimeSeconds += durationSeconds;
    }
  }

  // Check achievements unlocks
  const achievements = db.achievements.filter(a => a.studentId === studentId);
  const unlockedAchievementIds = new Set(achievements.map(a => a.title));
  const newUnlocked: Achievement[] = [];

  // Unlock Milestone: 5 Mastered Characters
  const masteredCount = db.characters.filter(c => c.studentId === studentId && c.learningLevel === 3).length;
  if (masteredCount >= 3 && !unlockedAchievementIds.has('Mandarin Master')) {
    const ach: Achievement = {
      id: `ach-${Date.now()}-1`,
      studentId: studentId!,
      title: 'Mandarin Master',
      description: 'Mastered 3 or more Chinese characters under active SM-2 retention.',
      unlockedAt: new Date().toISOString(),
      icon: '🏆'
    };
    db.achievements.push(ach);
    newUnlocked.push(ach);
    if (stats) stats.totalXp += 100;
  }

  // Unlock Milestone: High XP (500 XP)
  if (stats && stats.totalXp >= 500 && !unlockedAchievementIds.has('Scholar Elite')) {
    const ach: Achievement = {
      id: `ach-${Date.now()}-2`,
      studentId: studentId!,
      title: 'Scholar Elite',
      description: 'Accumulate more than 500 learning XP on the platform.',
      unlockedAt: new Date().toISOString(),
      icon: '🎓'
    };
    db.achievements.push(ach);
    newUnlocked.push(ach);
    stats.totalXp += 150;
  }

  saveDb(db);

  res.json({
    success: true,
    character: charItem,
    log: newLog,
    awardedXp: awardXp,
    newUnlockedAchievements: newUnlocked
  });
});


// --- DASHBOARD & STATISTICS ENDPOINT ---

app.get('/api/stats', requireAuth, (req: AuthRequest, res: Response) => {
  const studentId = req.user?.studentId;
  const db = getDb();

  const stats = db.stats.find(s => s.studentId === studentId) || {
    studentId: studentId!,
    currentStreak: 0,
    totalXp: 0,
    studyTimeSeconds: 0,
    lastActiveDate: null
  };

  const userChars = db.characters.filter(c => c.studentId === studentId);
  const logs = db.practiceLogs.filter(l => l.studentId === studentId);
  const achievements = db.achievements.filter(a => a.studentId === studentId);

  // Math aggregates
  const totalCharacters = userChars.length;
  const masteredCharacters = userChars.filter(c => c.learningLevel === 3).length;
  
  const todayStr = new Date().toISOString().split('T')[0];
  const charactersToReview = userChars.filter(c => {
    return c.nextReviewDate <= todayStr;
  }).length;

  let averageAccuracy = 0;
  if (logs.length > 0) {
    const totalScore = logs.reduce((sum, l) => sum + l.score, 0);
    averageAccuracy = Math.round(totalScore / logs.length);
  }

  res.json({
    studentId,
    fullName: req.user?.fullName,
    stats,
    totalCharacters,
    masteredCharacters,
    charactersToReview,
    averageAccuracy,
    achievements,
    practiceLogCount: logs.length,
    recentPracticeLogs: logs.slice(-10) // last 10 practice items
  });
});


// --- ADMIN SYSTEM PANEL ENDPOINTS ---

// Get all students and statistics
app.get('/api/admin/overview', requireAdmin, (req: AuthRequest, res: Response) => {
  const db = getDb();
  
  // Return list of all students with stats, excluding raw password hashes
  const studentsWithStats = db.students.map(s => {
    const stats = db.stats.find(st => st.studentId === s.studentId) || {
      currentStreak: 0,
      totalXp: 0,
      studyTimeSeconds: 0,
      lastActiveDate: null
    };
    const charsCount = db.characters.filter(c => c.studentId === s.studentId).length;
    
    return {
      id: s.id,
      studentId: s.studentId,
      fullName: s.fullName,
      role: s.role,
      disabled: s.disabled,
      createdAt: s.createdAt,
      stats,
      deckCount: charsCount
    };
  });

  const totalUsers = db.students.length;
  const totalCharactersLoaded = db.characters.length;
  const totalPracticeLogsRecorded = db.practiceLogs.length;

  res.json({
    students: studentsWithStats,
    overview: {
      totalUsers,
      totalCharactersLoaded,
      totalPracticeLogsRecorded
    }
  });
});

// Admin reset password for a student
app.post('/api/admin/students/reset-password', requireAdmin, (req: AuthRequest, res: Response) => {
  const { studentId, newPassword } = req.body;
  if (!studentId || !newPassword) {
    return res.status(400).json({ error: 'Student ID and new password are required.' });
  }

  const db = getDb();
  const student = db.students.find(s => s.studentId === studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student account not found.' });
  }

  const salt = bcrypt.genSaltSync(10);
  student.passwordHash = bcrypt.hashSync(newPassword, salt);
  saveDb(db);

  res.json({ success: true, message: `Password for Student ${studentId} was successfully updated.` });
});

// Admin toggle user account status (enable/disable)
app.post('/api/admin/students/toggle-status', requireAdmin, (req: AuthRequest, res: Response) => {
  const { studentId } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: 'Student ID is required.' });
  }

  const db = getDb();
  const student = db.students.find(s => s.studentId === studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student account not found.' });
  }

  if (student.role === 'admin') {
    return res.status(400).json({ error: 'Cannot disable another administrator.' });
  }

  student.disabled = !student.disabled;
  saveDb(db);

  res.json({ success: true, disabled: student.disabled, message: `Student status successfully changed.` });
});

// Admin delete student account
app.delete('/api/admin/students/:studentId', requireAdmin, (req: AuthRequest, res: Response) => {
  const { studentId } = req.params;

  const db = getDb();
  const index = db.students.findIndex(s => s.studentId === studentId);
  if (index === -1) {
    return res.status(404).json({ error: 'Student account not found.' });
  }

  const student = db.students[index];
  if (student.role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete an administrator account.' });
  }

  // Remove student
  db.students.splice(index, 1);
  
  // Clean up student data cascades
  db.characters = db.characters.filter(c => c.studentId !== studentId);
  db.practiceLogs = db.practiceLogs.filter(l => l.studentId !== studentId);
  db.stats = db.stats.filter(s => s.studentId !== studentId);
  db.achievements = db.achievements.filter(a => a.studentId !== studentId);

  saveDb(db);

  res.json({ success: true, message: `Student account ${studentId} and all associated data have been permanently purged.` });
});


// --- INTEGRATE VITE DEV / PROD MIDDLEWARE ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Sino3D V2.0 Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
