; 卸载时可选删除用户数据。
; storage/ 是解析出来的资料页和向量库，data/ 是题库和笔记 —— 都在 zhishi-backend/ 下。
; 默认保留：重装后还能接着用。用户明确选「是」才删。

!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除知拾的学习数据（资料、题库、笔记、对话记录）？$\r$\n$\r$\n选择「否」会保留，重装后可以继续用。" \
    IDNO zhishiKeepData
    RMDir /r "$INSTDIR\zhishi-backend\storage"
    RMDir /r "$INSTDIR\zhishi-backend\data"
  zhishiKeepData:
!macroend
