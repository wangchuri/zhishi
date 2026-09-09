"""模型注册：import 此包即可让所有 model 进入 Base.metadata。"""

from .kb import (
    Document,
    DocumentGroup,
    DocumentImage,
    DocumentSegment,
    GlobalDocument,
    KBCollection,
)
from .question import GlobalQuestion, QuestionProvenance, QuestionRef
from .learning_path import DocumentLearningPath
from .quiz import QuizAnswer, QuizSession, QuizSessionQuestion, TutorSession
from .tracking import (
    DailyActivity,
    PlanTask,
    Reminder,
    StudyPlan,
    TrainingPlan,
    UserAchievement,
    UserNote,
)
from .chat import ChatMessage, ChatSession, CompanionMessage, CompanionSession
from .goal import DailyTask, Goal, UserProfile

__all__ = [
    "KBCollection",
    "DocumentGroup",
    "GlobalDocument",
    "Document",
    "DocumentSegment",
    "DocumentImage",
    "GlobalQuestion",
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
]
