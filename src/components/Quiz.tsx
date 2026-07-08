import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.ts';
import { CharacterItem, Achievement } from '../types.ts';
import { 
  Check, X, Award, Sparkles, AlertCircle, ArrowRight, RotateCcw, 
  Clock, HelpCircle, CheckCircle2, Star, Keyboard, ThumbsUp, Volume2, Gamepad2, Info
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';

interface QuizProps {
  characters: CharacterItem[];
  mode: 'srs' | 'single';
  singleChar?: CharacterItem;
  onClose: () => void;
}

type QuizQuestionMode = 'multichoice_meaning' | 'multichoice_pinyin' | 'typing_pinyin' | 'stroke_trace';

interface QuizQuestion {
  characterItem: CharacterItem;
  mode: QuizQuestionMode;
  options: string[]; // for multiple choice
  correctAnswer: string;
}

interface StrokeResult {
  strokeNum: number;
  mistakes: number;
  isBackwards: boolean;
  status: 'correct' | 'acceptable' | 'incorrect';
}

// Motivational lists
const CORRECT_MESSAGES = [
  "⭐ Outstanding!",
  "🎉 Spot on!",
  "👏 Brilliant work!",
  "😊 Absolute mastery!",
  "💪 Excellent accuracy!",
  "🔥 Keep the fire burning!",
  "🎯 Bulleye!"
];

const INCORRECT_MESSAGES = [
  "💪 Keep practicing!",
  "🌱 Mistake is the best teacher!",
  "✨ You'll master this next time!",
  "🧠 Training neural pathways!",
  "📚 Dedication brings mastery!"
];

export default function Quiz({ characters, mode, singleChar, onClose }: QuizProps) {
  const [deck, setDeck] = useState<CharacterItem[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  
  // User answers & metrics
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isAnswerCorrect, setIsAnswerCorrect] = useState(false);
  const [motivationalMessage, setMotivationalMessage] = useState('');
  
  // Stroke Tracing Metrics
  const [strokeResults, setStrokeResults] = useState<StrokeResult[]>([]);
  const [correctStrokes, setCorrectStrokes] = useState(0);
  const [incorrectStrokes, setIncorrectStrokes] = useState(0);
  const [extraStrokes, setExtraStrokes] = useState(0);
  const [backwardsStrokes, setBackwardsStrokes] = useState(0);
  const [strokeScore, setStrokeScore] = useState(0);
  const [strokeRating, setStrokeRating] = useState<'Excellent' | 'Good' | 'Needs Improvement' | 'Incorrect'>('Excellent');
  
  // Quiz progress stats
  const [xpEarned, setXpEarned] = useState(0);
  const [studyDuration, setStudyDuration] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [unlockedAchievements, setUnlockedAchievements] = useState<Achievement[]>([]);
  
  // List of question results for summary calculation
  const [sessionResults, setSessionResults] = useState<{
    character: CharacterItem;
    mode: QuizQuestionMode;
    score: number;
    passed: boolean;
  }[]>([]);

  // Auto-advance countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [errorLog, setErrorLog] = useState<string | null>(null);

  const writerRef = useRef<any>(null);

  // Trigger audio cue and optional haptic feedback
  const playSoundAndVibrate = (type: 'excellent' | 'good' | 'needs_improvement' | 'incorrect') => {
    // Gentle vibration on mobile devices
    if ('vibrate' in navigator) {
      try {
        if (type === 'excellent' || type === 'good') {
          navigator.vibrate(60);
        } else {
          navigator.vibrate([100, 50, 100]);
        }
      } catch (e) {
        // Safe bypass
      }
    }

    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      if (type === 'excellent' || type === 'good') {
        const notes = type === 'excellent' ? [523.25, 659.25, 783.99, 1046.50] : [523.25, 659.25, 783.99]; 
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.08);
          gain.gain.setValueAtTime(0.08, ctx.currentTime + index * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.08 + 0.35);
          osc.start(ctx.currentTime + index * 0.08);
          osc.stop(ctx.currentTime + index * 0.08 + 0.35);
        });
      } else {
        const notes = [180, 140];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.12);
          gain.gain.setValueAtTime(0.05, ctx.currentTime + index * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.12 + 0.22);
          osc.start(ctx.currentTime + index * 0.12);
          osc.stop(ctx.currentTime + index * 0.12 + 0.22);
        });
      }
    } catch (err) {
      console.warn('Web Audio playback failed:', err);
    }
  };

  // Study timer
  useEffect(() => {
    const timer = setInterval(() => {
      setStudyDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Automatic advance countdown timer
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      handleNext();
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Launch celebration confetti when the session finishes
  useEffect(() => {
    if (isCompleted) {
      const duration = 2.5 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#10b981', '#0ea5e9', '#3b82f6', '#f59e0b']
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#10b981', '#0ea5e9', '#3b82f6', '#f59e0b']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      
      frame();

      // Launch full burst
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });
    }
  }, [isCompleted]);

  // Generate randomized deck and question sequence
  const buildQuizDeck = () => {
    let quizDeck: CharacterItem[] = [];
    if (mode === 'single' && singleChar) {
      quizDeck = [singleChar];
    } else {
      const shuffled = [...characters].sort(() => Math.random() - 0.5);
      quizDeck = shuffled.slice(0, 5);
    }

    if (quizDeck.length === 0) {
      setIsCompleted(true);
      return;
    }

    setDeck(quizDeck);

    const assembledQuestions: QuizQuestion[] = [];
    quizDeck.forEach(char => {
      // Assemble multiple diverse quiz patterns per card
      assembledQuestions.push({
        characterItem: char,
        mode: 'multichoice_meaning',
        options: generateOptions(char, 'meaning', characters),
        correctAnswer: char.englishMeaning
      });

      assembledQuestions.push({
        characterItem: char,
        mode: 'typing_pinyin',
        options: [],
        correctAnswer: char.pinyin
      });

      assembledQuestions.push({
        characterItem: char,
        mode: 'stroke_trace',
        options: [],
        correctAnswer: char.character
      });
    });

    // Randomize the order of questions to prevent mechanical repeating
    setQuestions(assembledQuestions.sort(() => Math.random() - 0.5));
    setCurrentIdx(0);
    setSessionResults([]);
    setIsCompleted(false);
    setXpEarned(0);
    setUnlockedAchievements([]);
  };

  // Assemble and prepare quiz questions
  useEffect(() => {
    buildQuizDeck();
  }, [characters, mode, singleChar]);

  // Mount HanziWriter for drawing questions
  useEffect(() => {
    if (isCompleted || questions.length === 0 || currentIdx >= questions.length) return;
    const currentQ = questions[currentIdx];
    if (currentQ.mode !== 'stroke_trace') return;

    // Reset stroke specific states
    setStrokeResults([]);
    setCorrectStrokes(0);
    setIncorrectStrokes(0);
    setExtraStrokes(0);
    setBackwardsStrokes(0);

    const timer = setTimeout(() => {
      const container = document.getElementById('quiz-canvas-container');
      if (!container) return;
      container.innerHTML = '';

      if ((window as any).HanziWriter) {
        try {
          const writer = (window as any).HanziWriter.create('quiz-canvas-container', currentQ.characterItem.character, {
            width: 250,
            height: 250,
            padding: 15,
            strokeAnimationSpeed: 1.25,
            delayBetweenStrokes: 150,
            strokeColor: '#10b981', // Emerald-500
            outlineColor: '#f8fafc', // slate-50
            drawingColor: '#0ea5e9', // sky-500
            drawingThickness: 10,
            showOutline: true
          });

          writerRef.current = writer;

          const tempStrokeResults: StrokeResult[] = [];

          writer.quiz({
            onStrokeCorrect: (strokeData: any) => {
              const { strokeNum, mistakesOnStroke, isBackwards } = strokeData;
              
              let status: 'correct' | 'acceptable' | 'incorrect' = 'correct';
              if (mistakesOnStroke >= 2) {
                status = 'incorrect';
              } else if (mistakesOnStroke === 1 || isBackwards) {
                status = 'acceptable';
              }

              const res: StrokeResult = {
                strokeNum,
                mistakes: mistakesOnStroke,
                isBackwards,
                status
              };

              tempStrokeResults.push(res);
              setStrokeResults([...tempStrokeResults]);

              setCorrectStrokes(prev => prev + 1);
              if (mistakesOnStroke > 0) setExtraStrokes(prev => prev + mistakesOnStroke);
              if (isBackwards) setBackwardsStrokes(prev => prev + 1);
            },
            onStrokeIncorrect: () => {
              setIncorrectStrokes(prev => prev + 1);
            },
            onComplete: () => {
              const totalStrokes = currentQ.characterItem.strokeCount;
              const completedStrokes = tempStrokeResults.length;
              const strokeCompletionRatio = totalStrokes > 0 ? (completedStrokes / totalStrokes) : 1;

              let deductions = 0;
              tempStrokeResults.forEach(r => {
                if (r.isBackwards) deductions += 4; 
                deductions += (r.mistakes * 6); 
              });

              let rawScore = Math.max(10, Math.round((100 - deductions) * strokeCompletionRatio));
              
              let rating: 'Excellent' | 'Good' | 'Needs Improvement' | 'Incorrect' = 'Incorrect';
              if (rawScore >= 90) {
                rating = 'Excellent';
              } else if (rawScore >= 75) {
                rating = 'Good';
              } else if (rawScore >= 50) {
                rating = 'Needs Improvement';
              }

              setStrokeScore(rawScore);
              setStrokeRating(rating);
              const isPassed = rawScore >= 70;
              setIsAnswerCorrect(isPassed);
              setHasAnswered(true);

              // Select randomized motivational greeting
              setMotivationalMessage(
                isPassed 
                  ? CORRECT_MESSAGES[Math.floor(Math.random() * CORRECT_MESSAGES.length)]
                  : INCORRECT_MESSAGES[Math.floor(Math.random() * INCORRECT_MESSAGES.length)]
              );

              // Sound output & Haptic vibration
              const soundType = rating === 'Excellent' ? 'excellent' :
                                rating === 'Good' ? 'good' :
                                rating === 'Needs Improvement' ? 'needs_improvement' : 'incorrect';
              playSoundAndVibrate(soundType);

              setSessionResults(prev => [...prev, {
                character: currentQ.characterItem,
                mode: 'stroke_trace',
                score: rawScore,
                passed: isPassed
              }]);

              handleLogPracticeOnServer(currentQ.characterItem.id, 'stroke', rawScore);
              setCountdown(4);
            }
          });
        } catch (err) {
          console.error('Error starting HanziWriter quiz:', err);
        }
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [currentIdx, questions, isCompleted]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;

      const key = e.key.toLowerCase();
      
      // Space = Play pronunciation
      if (e.key === ' ' && !hasAnswered) {
        e.preventDefault();
        const currentQ = questions[currentIdx];
        if (currentQ) {
          handleSpeak(currentQ.characterItem.character);
        }
      }
      
      // Escape = Exit Quiz
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Enter = Continue/Skip countdown or confirm answer
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hasAnswered) {
          handleNext();
        } else {
          const currentQ = questions[currentIdx];
          if (currentQ && currentQ.mode === 'typing_pinyin' && typedAnswer.trim()) {
            checkAnswer(typedAnswer);
          }
        }
      }

      // Number keys 1, 2, 3, 4 for Multiple Choice
      const currentQ = questions[currentIdx];
      if (currentQ && currentQ.mode === 'multichoice_meaning' && !hasAnswered) {
        if (['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          const optionIndex = parseInt(e.key) - 1;
          const selectedVal = currentQ.options[optionIndex];
          if (selectedVal) {
            setSelectedOption(selectedVal);
            checkAnswer(selectedVal);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIdx, questions, hasAnswered, typedAnswer, isCompleted]);

  // Handle multiple-choice option generator
  const generateOptions = (char: CharacterItem, type: 'meaning', pool: CharacterItem[]): string[] => {
    const list = pool.filter(c => c.id !== char.id);
    const correct = char.englishMeaning;
    const optionsSet = new Set<string>([correct]);

    const attempts = 15;
    for (let i = 0; i < attempts && optionsSet.size < 4; i++) {
      if (list.length > 0) {
        const rand = list[Math.floor(Math.random() * list.length)];
        optionsSet.add(rand.englishMeaning);
      } else {
        const defaultPool = ['mountain', 'water', 'person', 'heaven', 'good', 'book'];
        optionsSet.add(defaultPool[Math.floor(Math.random() * defaultPool.length)]);
      }
    }
    return Array.from(optionsSet).sort(() => Math.random() - 0.5);
  };

  // Play natural speech pronunciation (respecting user configuration in localStorage)
  const handleSpeak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    const savedVoiceName = localStorage.getItem('sino3d_voice_name');
    const savedSpeed = localStorage.getItem('sino3d_playback_speed');
    
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    if (isChinese) {
      utterance.lang = 'zh-CN';
      if (savedVoiceName) {
        const voices = window.speechSynthesis.getVoices();
        const selected = voices.find(v => v.name === savedVoiceName);
        if (selected) utterance.voice = selected;
      }
    } else {
      utterance.lang = 'en-US';
    }
    
    if (savedSpeed) {
      utterance.rate = parseFloat(savedSpeed);
    } else {
      utterance.rate = 0.75; // Comfortable slow rate for beginners
    }
    
    window.speechSynthesis.speak(utterance);
  };

  const stripToneMarks = (str: string): string => {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ü/g, "u")
      .replace(/v/g, "u")
      .replace(/ā/g, 'a').replace(/á/g, 'a').replace(/ǎ/g, 'a').replace(/à/g, 'a')
      .replace(/ē/g, 'e').replace(/é/g, 'e').replace(/ě/g, 'e').replace(/è/g, 'e')
      .replace(/ī/g, 'i').replace(/í/g, 'i').replace(/ǐ/g, 'i').replace(/ì/g, 'i')
      .replace(/ō/g, 'o').replace(/ó/g, 'o').replace(/ǒ/g, 'o').replace(/ò/g, 'o')
      .replace(/ū/g, 'u').replace(/ú/g, 'u').replace(/ǔ/g, 'u').replace(/ù/g, 'u')
      .replace(/ü/g, 'u').replace(/ǘ/g, 'u').replace(/ǚ/g, 'u').replace(/ǜ/g, 'u')
      .toLowerCase();
  };

  // Submit multiple choice or written typing answers
  const checkAnswer = (answer: string) => {
    if (hasAnswered) return;
    const currentQ = questions[currentIdx];
    let isCorrect = false;

    if (currentQ.mode === 'typing_pinyin') {
      const cleanTyped = stripToneMarks(answer.trim());
      const cleanTarget = stripToneMarks(currentQ.correctAnswer.trim());
      isCorrect = (cleanTyped === cleanTarget || answer.trim().toLowerCase() === currentQ.correctAnswer.trim().toLowerCase());
    } else {
      isCorrect = (answer === currentQ.correctAnswer);
    }

    const calculatedScore = isCorrect ? 100 : 10;
    setIsAnswerCorrect(isCorrect);
    setHasAnswered(true);

    // Dynamic motivational prompt
    setMotivationalMessage(
      isCorrect 
        ? CORRECT_MESSAGES[Math.floor(Math.random() * CORRECT_MESSAGES.length)]
        : INCORRECT_MESSAGES[Math.floor(Math.random() * INCORRECT_MESSAGES.length)]
    );

    // Audio and vibration cues
    playSoundAndVibrate(isCorrect ? 'excellent' : 'incorrect');

    setSessionResults(prev => [...prev, {
      character: currentQ.characterItem,
      mode: currentQ.mode,
      score: calculatedScore,
      passed: isCorrect
    }]);

    const modeMap: { [key: string]: string } = {
      'multichoice_meaning': 'meaning',
      'typing_pinyin': 'typing'
    };

    handleLogPracticeOnServer(
      currentQ.characterItem.id,
      modeMap[currentQ.mode] || 'multichoice',
      calculatedScore
    );

    setCountdown(4);
  };

  // Log progress to DB
  const handleLogPracticeOnServer = async (charId: string, quizType: string, score: number) => {
    setLoadingLog(true);
    try {
      const res = await api.logPractice(charId, quizType, score, 6); 
      setXpEarned(prev => prev + res.awardedXp);
      if (res.newUnlockedAchievements && res.newUnlockedAchievements.length > 0) {
        setUnlockedAchievements(prev => [...prev, ...res.newUnlockedAchievements]);
      }
    } catch (err: any) {
      setErrorLog(err.message || 'Failed to submit practice log.');
    } finally {
      setLoadingLog(false);
    }
  };

  const handleNext = () => {
    setCountdown(null);
    setSelectedOption(null);
    setTypedAnswer('');
    setHasAnswered(false);
    setIsAnswerCorrect(false);
    setMotivationalMessage('');

    if (currentIdx + 1 < questions.length) {
      setCurrentIdx(prev => prev + 1);
    } else {
      setIsCompleted(true);
    }
  };

  // Calculate final summary page metrics
  const getSummaryMetrics = () => {
    const total = sessionResults.length;
    const correctAnswers = sessionResults.filter(r => r.passed).length;
    const incorrectAnswers = total - correctAnswers;
    const avgAccuracy = total > 0 ? Math.round((correctAnswers / total) * 100) : 0;
    
    const strokeQuestions = sessionResults.filter(r => r.mode === 'stroke_trace');
    const avgStrokeScore = strokeQuestions.length > 0
      ? Math.round(strokeQuestions.reduce((sum, q) => sum + q.score, 0) / strokeQuestions.length)
      : 0;

    const reviewSet = new Set<string>();
    const masteredSet = new Set<string>();

    sessionResults.forEach(r => {
      if (r.score < 70) {
        reviewSet.add(r.character.character);
      } else if (r.score >= 90) {
        masteredSet.add(r.character.character);
      }
    });

    return {
      totalQuestions: total,
      correctAnswers,
      incorrectAnswers,
      avgAccuracy,
      avgStrokeScore,
      reviewAgain: Array.from(reviewSet),
      mastered: Array.from(masteredSet)
    };
  };

  // Reset local state and retry a fresh new quiz deck
  const handleRetryQuiz = () => {
    buildQuizDeck();
  };

  if (isCompleted) {
    const metrics = getSummaryMetrics();
    
    // Choose encouraging feedback banner
    let rewardTier: 'outstanding' | 'excellent' | 'great' | 'progress' | 'practice' = 'practice';
    let feedbackEmoji = '💪';
    let feedbackText = 'Keep Practicing!';
    let feedbackColor = 'text-slate-600 bg-slate-100 border-slate-200/50';

    if (metrics.avgAccuracy >= 90) {
      rewardTier = 'outstanding';
      feedbackEmoji = '⭐';
      feedbackText = 'Outstanding!';
      feedbackColor = 'text-amber-700 bg-amber-50 border-amber-200';
    } else if (metrics.avgAccuracy >= 80) {
      rewardTier = 'excellent';
      feedbackEmoji = '🎉';
      feedbackText = 'Excellent Work!';
      feedbackColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';
    } else if (metrics.avgAccuracy >= 70) {
      rewardTier = 'great';
      feedbackEmoji = '👏';
      feedbackText = 'Great Job!';
      feedbackColor = 'text-sky-700 bg-sky-50 border-sky-200';
    } else if (metrics.avgAccuracy >= 50) {
      rewardTier = 'progress';
      feedbackEmoji = '😊';
      feedbackText = 'Good Progress!';
      feedbackColor = 'text-indigo-700 bg-indigo-50 border-indigo-200';
    }

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-2xl mx-auto bg-white border border-slate-100 rounded-3xl shadow-xl overflow-hidden p-6 md:p-8 space-y-8 relative z-10"
      >
        
        {/* Animated Celebration Icon */}
        <div className="relative flex justify-center py-2">
          <motion.div 
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
            className="w-24 h-24 bg-gradient-to-tr from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-4xl shadow-lg shadow-emerald-500/20 border border-emerald-300 relative z-10"
          >
            {feedbackEmoji}
          </motion.div>
          <div className="absolute top-2 w-28 h-28 bg-emerald-100 rounded-full animate-ping opacity-30"></div>
        </div>

        <div className="text-center space-y-2">
          <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${feedbackColor}`}>
            <span>{feedbackEmoji}</span>
            <span>{feedbackText}</span>
          </span>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Session Completed!</h2>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">All session logs successfully synced with server database</p>
        </div>

        {/* Detailed Premium Performance Bento Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 text-center shadow-xs">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">XP Earned</span>
            <span className="text-2xl font-black text-emerald-600 block">+{xpEarned} XP</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase">Total Awarded</span>
          </div>
          
          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 text-center shadow-xs">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Accuracy</span>
            <span className="text-2xl font-black text-indigo-600 block">{metrics.avgAccuracy}%</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase">{metrics.correctAnswers} of {metrics.totalQuestions} Right</span>
          </div>

          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 text-center shadow-xs">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Stroke Precision</span>
            <span className="text-2xl font-black text-teal-600 block">{metrics.avgStrokeScore}/100</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase">Stroke rating</span>
          </div>

          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 text-center shadow-xs">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Study Duration</span>
            <span className="text-2xl font-black text-amber-600 block font-mono">
              {Math.floor(studyDuration / 60)}m {studyDuration % 60}s
            </span>
            <span className="text-[9px] font-bold text-slate-400 uppercase">Time spent</span>
          </div>
        </div>

        {/* Characters breakdown list */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-slate-600">
          <div className="bg-emerald-50/30 p-4 rounded-2xl border border-emerald-100/40 space-y-2">
            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest block flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Character Mastered (&ge; 90)
            </span>
            {metrics.mastered.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {metrics.mastered.map(char => (
                  <motion.span 
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    key={char} 
                    onClick={() => handleSpeak(char)}
                    className="w-9 h-9 bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-200/50 rounded-xl flex items-center justify-center font-black text-base shadow-xs cursor-pointer transition-all"
                    title="Pronounce Character"
                  >
                    {char}
                  </motion.span>
                ))}
              </div>
            ) : (
              <span className="text-slate-400 italic text-[10px] block pt-1">None this session</span>
            )}
          </div>

          <div className="bg-rose-50/30 p-4 rounded-2xl border border-rose-100/40 space-y-2">
            <span className="text-[9px] font-black text-rose-600 uppercase tracking-widest block flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Review Recommended (&lt; 70)
            </span>
            {metrics.reviewAgain.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {metrics.reviewAgain.map(char => (
                  <motion.span 
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    key={char} 
                    onClick={() => handleSpeak(char)}
                    className="w-9 h-9 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200/50 rounded-xl flex items-center justify-center font-black text-base shadow-xs cursor-pointer transition-all"
                    title="Pronounce Character"
                  >
                    {char}
                  </motion.span>
                ))}
              </div>
            ) : (
              <span className="text-emerald-600 text-[10px] font-black block pt-1">🎉 Perfect 100% retention!</span>
            )}
          </div>
        </div>

        {/* STUDY META DETAILS BAR */}
        <div className="flex justify-between items-center bg-slate-50 border border-slate-100 p-4 rounded-2xl text-[10px] text-slate-500 font-bold px-5 shadow-inner">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>Spaced SM-2 Learning Session</span>
          </div>
          <div>
            <span className="text-slate-400 font-black">MODE:</span> {mode === 'single' ? 'Focused Practice' : 'Spaced Repetition'}
          </div>
        </div>

        {/* Milestone Unlocked Rewards */}
        {unlockedAchievements.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-left space-y-3 shadow-xs">
            <h3 className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
              <span>Milestones Unlocked! (+Bonus XP)</span>
            </h3>
            <div className="space-y-2">
              {unlockedAchievements.map(ach => (
                <div key={ach.id} className="flex items-center gap-2.5 bg-white p-2.5 border border-amber-100 rounded-xl">
                  <span className="text-2xl">{ach.icon}</span>
                  <div className="text-xs">
                    <p className="font-extrabold text-slate-800">{ach.title}</p>
                    <p className="text-slate-400 font-bold leading-normal">{ach.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Row Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleRetryQuiz}
            className="flex-1 bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/50 font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Retry Session</span>
          </motion.button>
          
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onClose}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest transition-all shadow-md shadow-emerald-500/10 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Continue Learning</span>
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>

      </motion.div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-24 bg-white border border-slate-100 rounded-3xl max-w-md mx-auto p-8 shadow-sm">
        <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-3 animate-spin" />
        <p className="text-slate-500 font-black text-xs uppercase tracking-widest">Assembling study queue...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIdx];
  const progressPercent = Math.round(((currentIdx + 1) / questions.length) * 100);

  return (
    <div className="max-w-xl mx-auto bg-white border border-slate-100 rounded-3xl shadow-xl overflow-hidden flex flex-col relative transition-all duration-300">
      
      {/* Quiz Progress Header with Keyboard Indicator */}
      <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-4 shrink-0">
        <button 
          onClick={onClose} 
          className="text-[10px] font-black text-rose-500 hover:text-rose-600 uppercase tracking-widest cursor-pointer"
        >
          Quit
        </button>

        {/* Progress line */}
        <div className="flex-1 max-w-xs bg-slate-200 h-2.5 rounded-full overflow-hidden relative shadow-inner">
          <div 
            className="bg-emerald-500 h-full transition-all duration-500 rounded-full"
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>

        <div className="text-right flex flex-col">
          <span className="text-xs font-black text-slate-800">
            {currentIdx + 1} / {questions.length}
          </span>
          <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
            {questions.length - (currentIdx + 1)} remaining
          </span>
        </div>
      </div>

      {/* Main Play Area */}
      <div className="p-6 md:p-8 flex-1 flex flex-col items-center justify-center space-y-6">
        
        {/* Playback Indicators */}
        <div className="w-full flex justify-between items-center text-[9px] text-slate-400 font-black uppercase tracking-widest px-2">
          <span className="flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-emerald-500" /> +25 XP Reward
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" /> Active Practice
          </span>
        </div>

        {/* The character cue */}
        <div className="text-center space-y-3">
          <div className="relative">
            <span className="w-24 h-24 bg-slate-50 border border-slate-200/50 rounded-3xl flex items-center justify-center font-black text-slate-800 text-5xl mx-auto shadow-sm transform hover:scale-105 hover:bg-white transition-all duration-300">
              {currentQuestion.characterItem.character}
            </span>
            <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white font-black text-[9px] w-5 h-5 rounded-full flex items-center justify-center border border-white">
              HSK
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-2">
            <button 
              onClick={() => handleSpeak(currentQuestion.characterItem.character)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] uppercase tracking-widest font-black bg-slate-50 hover:bg-emerald-50 border border-slate-200/40 hover:border-emerald-200 text-slate-500 hover:text-emerald-600 transition-all cursor-pointer"
              title="Hear Pronunciation (Spacebar)"
            >
              <Volume2 className="w-3.5 h-3.5 animate-pulse" /> 
              <span>Listen</span>
            </button>
          </div>
        </div>

        {/* Question prompt context */}
        <div className="text-center max-w-sm space-y-1.5">
          <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100/50 rounded-full px-3 py-0.5 w-max mx-auto uppercase tracking-wider block">
            {currentQuestion.mode === 'multichoice_meaning' && 'Multiple Choice'}
            {currentQuestion.mode === 'typing_pinyin' && 'Tone Spelling'}
            {currentQuestion.mode === 'stroke_trace' && 'Writing Practice'}
          </span>
          <h3 className="font-extrabold text-lg text-slate-800 tracking-tight leading-snug">
            {currentQuestion.mode === 'multichoice_meaning' && 'What is the correct English translation?'}
            {currentQuestion.mode === 'typing_pinyin' && 'Type the exact Pinyin for this Hanzi.'}
            {currentQuestion.mode === 'stroke_trace' && 'Trace the strokes on the grid canvas in correct order!'}
          </h3>
        </div>

        {/* ACTIVE MODULE CONTAINER */}
        <div className="w-full">
          
          {/* Multiple choice module */}
          {currentQuestion.mode === 'multichoice_meaning' && (
            <div className="space-y-4 w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {currentQuestion.options.map((option, index) => {
                  const isSelected = selectedOption === option;
                  let optionStyle = 'border-slate-100 bg-slate-50/40 hover:bg-slate-100/60 text-slate-700 hover:border-slate-200';
                  
                  if (hasAnswered) {
                    if (option === currentQuestion.correctAnswer) {
                      optionStyle = 'border-emerald-500 bg-emerald-50 text-emerald-800 scale-98 shadow-xs';
                    } else if (isSelected) {
                      optionStyle = 'border-rose-400 bg-rose-50 text-rose-800 scale-98';
                    } else {
                      optionStyle = 'border-slate-100 bg-slate-50/50 opacity-30 scale-95';
                    }
                  } else if (isSelected) {
                    optionStyle = 'border-emerald-500 bg-emerald-50/30 text-emerald-800';
                  }

                  return (
                    <button
                      key={index}
                      disabled={hasAnswered}
                      onClick={() => {
                        setSelectedOption(option);
                        checkAnswer(option);
                      }}
                      className={`p-4 rounded-2xl border-2 text-center text-xs font-black transition-all cursor-pointer relative flex justify-between items-center ${optionStyle}`}
                    >
                      <span className="w-5 h-5 bg-white border border-slate-200/60 rounded-lg flex items-center justify-center text-[9px] text-slate-400 font-bold">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-center pr-5 font-bold">{option}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-center">
                <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider flex items-center justify-center gap-1">
                  <Keyboard className="w-3.5 h-3.5 text-slate-300" /> Keyboard Hotkeys: Press [1], [2], [3], or [4] to answer!
                </span>
              </div>
            </div>
          )}

          {/* Typing pinyin module */}
          {currentQuestion.mode === 'typing_pinyin' && (
            <div className="space-y-4 max-w-sm mx-auto">
              <div className="relative">
                <Keyboard className="absolute left-3.5 top-3.5 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="e.g. nǐ or hǎo"
                  disabled={hasAnswered}
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !hasAnswered && typedAnswer.trim()) {
                      checkAnswer(typedAnswer);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 pl-11 pr-4 text-center font-black text-sm text-slate-800 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all shadow-inner focus:ring-4 focus:ring-emerald-500/10"
                  autoFocus
                />
              </div>

              {!hasAnswered && (
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => checkAnswer(typedAnswer)}
                  disabled={!typedAnswer.trim()}
                  className="w-full bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest transition-all shadow-md cursor-pointer"
                >
                  Verify Answer
                </motion.button>
              )}
            </div>
          )}

          {/* Trace strokes module */}
          {currentQuestion.mode === 'stroke_trace' && (
            <div className="flex flex-col items-center space-y-4">
              <div className="bg-white p-3.5 rounded-3xl border border-slate-200/50 shadow-inner flex items-center justify-center w-[270px] h-[270px] relative">
                <div id="quiz-canvas-container" className="w-[250px] h-[250px] flex items-center justify-center"></div>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Draw directly inside the grid canvas</p>
            </div>
          )}

        </div>

      </div>

      {/* Answer feedback tray */}
      {hasAnswered && (
        <div className={`p-5 md:p-6 border-t border-slate-150 flex flex-col items-stretch gap-4 shrink-0 transition-all duration-300 ${
          isAnswerCorrect ? 'bg-emerald-50/50' : 'bg-rose-50/50'
        }`}>
          
          {/* Detailed Stroke Breakdown for stroke traces */}
          {currentQuestion.mode === 'stroke_trace' && (
            <div className="bg-white p-4 rounded-2xl border border-slate-200/80 space-y-3 shadow-xs">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stroke Writing Analysis</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  strokeScore >= 90 ? 'bg-emerald-100 text-emerald-700' :
                  strokeScore >= 75 ? 'bg-teal-100 text-teal-700' :
                  strokeScore >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                }`}>
                  {strokeRating}
                </span>
              </div>

              {/* Score visualizer */}
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-600">Accuracy Score:</span>
                <span className="font-black text-slate-800 text-sm">{strokeScore} / 100</span>
              </div>

              {/* Color coded stroke badges */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Stroke-by-stroke Accuracy</span>
                <div className="flex flex-wrap gap-1.5">
                  {strokeResults.map((r, idx) => (
                    <div 
                      key={idx}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                        r.status === 'correct' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                        r.status === 'acceptable' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                        'bg-rose-50 border-rose-200 text-rose-700'
                      }`}
                      title={`Stroke ${r.strokeNum + 1}: ${r.mistakes} errors, backwards: ${r.isBackwards}`}
                    >
                      <span>S{r.strokeNum + 1}</span>
                      {r.status === 'correct' && <Check className="w-3 h-3" />}
                      {r.status === 'acceptable' && <ThumbsUp className="w-3 h-3" />}
                      {r.status === 'incorrect' && <X className="w-3 h-3" />}
                    </div>
                  ))}
                  {strokeResults.length === 0 && (
                    <span className="text-slate-400 italic text-[10px]">Processing strokes...</span>
                  )}
                </div>
              </div>

              {/* visualizer colors legend */}
              <div className="flex gap-4 pt-1 text-[9px] font-black text-slate-400 uppercase tracking-wider justify-center border-t border-slate-100">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span> Green: Correct</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-full"></span> Yellow: Acceptable</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full"></span> Red: Incorrect</span>
              </div>
            </div>
          )}

          {/* Standard feedback indicators with Motivational banner */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-md ${
                isAnswerCorrect ? 'bg-emerald-500 shadow-emerald-200/60' : 'bg-rose-500 shadow-rose-200/60'
              }`}>
                {isAnswerCorrect ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
              </div>
              <div className="text-left">
                <span className={`text-[9px] font-black uppercase tracking-wider block ${isAnswerCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {motivationalMessage}
                </span>
                <h4 className="font-extrabold text-sm text-slate-800 leading-tight">
                  {isAnswerCorrect ? 'Excellent! Correct.' : 'Incorrect Review'}
                </h4>
                <p className="text-xs text-slate-400 font-bold mt-0.5">
                  Correct answer: <span className="font-black text-emerald-600">{currentQuestion.correctAnswer}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {countdown !== null && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleNext}
                  className="w-full sm:w-auto bg-slate-800 hover:bg-slate-900 text-white font-black text-[10px] px-5 py-3.5 rounded-xl uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <span>Next ({countdown}s)</span>
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
