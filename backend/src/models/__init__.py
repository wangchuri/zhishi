"""模型注册：import 此包即可让所有 model 进入 Base.metadata。"""

from .kb import (
    Document,
    DocumentGroup,
    DocumentImage,
    DocumentSegment,
    GlobalDocument,
    KBCollection,
)
from .question import GlobalQuestion, QuestionMaterial, QuestionProvenance, QuestionRef
from .learning_path import DocumentLearningPath
from .quiz import QuizAnswer, QuizSession, QuizSessionQuestion, TutorSession
from .tracking import (
    DailyActivity,
    NoteFolder,
    PlanTask,
    Reminder,
    StudyPlan,
    TrainingPlan,
    UserAchievement,
    UserNote,
)
from .chat import ChatMessage, ChatSession, CompanionMessage, CompanionSession
from .goal import DailyTask, Goal, UserProfile
from .auth import AuthSession, AuthUser

__all__ = [
    "KBCollection",
    "DocumentGroup",
    "GlobalDocument",
    "Document",
    "DocumentSegment",
    "DocumentImage",
    "GlobalQuestion",
    "QuestionMaterial",
    "QuestionProvenance",
    "QuestionRef",
    "DocumentLearningPath",
    "QuizSession",
    "QuizSessionQuestion",
    "QuizAnswer",
    "TutorSession",
    "DailyActivity",
    "UserAchievement",
    "UserNote",
    "NoteFolder",
    "Reminder",
    "StudyPlan",
    "PlanTask",
    "TrainingPlan",
    "ChatSession",
    "ChatMessage",
    "CompanionSession",
    "CompanionMessage",
    "Goal",
    "DailyTask",
    "UserProfile",
    "AuthUser",
    "AuthSession",
]
