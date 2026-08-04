from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Integer, UniqueConstraint

from app.core.database import Base


class DailyActivity(Base):
    """按用户/日期累计的活跃学习时长（前端心跳上报）。"""

    __tablename__ = "daily_activity"
    __table_args__ = (
        UniqueConstraint("user_id", "activity_date", name="uq_daily_activity_user_date"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    activity_date = Column(Date, nullable=False, index=True)
    active_seconds = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
