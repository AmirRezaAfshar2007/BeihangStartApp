import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Student, CharacterItem, PracticeLog, StudentStats, Achievement, UserSession } from './types.ts';

const DB_FILE = path.resolve(process.cwd(), 'db.json');

interface Schema {
  students: Student[];
  characters: CharacterItem[];
  practiceLogs: PracticeLog[];
  stats: StudentStats[];
  achievements: Achievement[];
  sessions: UserSession[];
}

// Default initial database schema
const defaultDb: Schema = {
  students: [],
  characters: [],
  practiceLogs: [],
  stats: [],
  achievements: [],
  sessions: [],
};

export function getDb(): Schema {
  try {
    if (!fs.existsSync(DB_FILE)) {
      initializeDbSync();
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return defaultDb;
  }
}

export function saveDb(data: Schema): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing db.json:', err);
  }
}

function initializeDbSync(): void {
  console.log('Initializing db.json with seed data...');
  const salt = bcrypt.genSaltSync(10);
  
  // Seed an Admin (401120000) and a Student (401120145)
  const defaultAdmin: Student = {
    id: 'admin-id',
    studentId: '401120000',
    fullName: 'Professor Zhang (Admin)',
    passwordHash: bcrypt.hashSync('admin123', salt),
    role: 'admin',
    disabled: false,
    createdAt: new Date().toISOString(),
  };

  const defaultStudent: Student = {
    id: 'student-id-1',
    studentId: '401120145',
    fullName: 'Alex River',
    passwordHash: bcrypt.hashSync('password123', salt),
    role: 'student',
    disabled: false,
    createdAt: new Date().toISOString(),
  };

  const defaultStats: StudentStats[] = [
    {
      studentId: '401120145',
      currentStreak: 5,
      totalXp: 450,
      studyTimeSeconds: 1200,
      lastActiveDate: new Date().toISOString().split('T')[0],
    },
    {
      studentId: '401120000',
      currentStreak: 0,
      totalXp: 0,
      studyTimeSeconds: 0,
      lastActiveDate: null,
    }
  ];

  // Seed default characters for Alex River (401120145)
  const defaultCharacters: CharacterItem[] = [
    {
      id: 'char-1',
      studentId: '401120145',
      character: '你',
      simplified: '你',
      traditional: '你',
      pinyin: 'nǐ',
      englishMeaning: 'you (singular, polite)',
      persianMeaning: '',
      radicals: ['人', '尔'],
      strokeCount: 7,
      hskLevel: 1,
      frequencyRank: 9,
      exampleWords: [
        { word: '你好', pinyin: 'nǐ hǎo', meaning: 'hello' },
        { word: '你们', pinyin: 'nǐ men', meaning: 'you (plural)' }
      ],
      exampleSentences: [
        { sentence: '你好吗？', pinyin: 'Nǐ hǎo ma?', meaning: 'How are you?' },
        { sentence: '我很想念你。', pinyin: 'Wǒ hěn xiǎngniàn nǐ.', meaning: 'I miss you very much.' }
      ],
      audioPronunciation: '',
      dateAdded: new Date().toISOString(),
      lastReviewed: null,
      reviewCount: 0,
      learningLevel: 1,
      memoryStability: 50,
      interval: 1,
      nextReviewDate: new Date().toISOString().split('T')[0],
    },
    {
      id: 'char-2',
      studentId: '401120145',
      character: '好',
      simplified: '好',
      traditional: '好',
      pinyin: 'hǎo',
      englishMeaning: 'good, well, fine',
      persianMeaning: '',
      radicals: ['女', '子'],
      strokeCount: 6,
      hskLevel: 1,
      frequencyRank: 14,
      exampleWords: [
        { word: '好看', pinyin: 'hǎo kàn', meaning: 'good-looking' },
        { word: '好吃', pinyin: 'hǎo chī', meaning: 'delicious' }
      ],
      exampleSentences: [
        { sentence: '今天天气很好。', pinyin: 'Jīntiān tiānqì hěn hǎo.', meaning: 'Today\'s weather is very good.' }
      ],
      audioPronunciation: '',
      dateAdded: new Date().toISOString(),
      lastReviewed: null,
      reviewCount: 0,
      learningLevel: 0,
      memoryStability: 30,
      interval: 1,
      nextReviewDate: new Date().toISOString().split('T')[0],
    }
  ];

  const defaultAchievements: Achievement[] = [
    {
      id: 'ach-1',
      studentId: '401120145',
      title: 'First Step',
      description: 'Logged in to Sino3D Chinese Calligraphy platform.',
      unlockedAt: new Date().toISOString(),
      icon: '🚀'
    },
    {
      id: 'ach-2',
      studentId: '401120145',
      title: 'Day Starter',
      description: 'Accumulate a 5-day continuous learning streak.',
      unlockedAt: new Date().toISOString(),
      icon: '🔥'
    }
  ];

  const seedSchema: Schema = {
    students: [defaultAdmin, defaultStudent],
    characters: defaultCharacters,
    practiceLogs: [],
    stats: defaultStats,
    achievements: defaultAchievements,
    sessions: [],
  };

  fs.writeFileSync(DB_FILE, JSON.stringify(seedSchema, null, 2), 'utf-8');
}
