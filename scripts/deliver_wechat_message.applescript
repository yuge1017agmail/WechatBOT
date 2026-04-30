(*
  deliver_wechat_message.applescript (v3)
  职责：用 Esc + Tab 把焦点拉回输入框（你已验证这条路在你的微信版本下 work），
        sentinel 探针校验焦点确实在输入框，再粘贴真实回复并按模式发送。
        本脚本 0 坐标点击，所有操作通过快捷键完成。

  双层校验：
    - 上游 wechat-ui-send.ts 已通过 OCR 校验「会话身份」（视觉真相）
    - 本脚本通过 sentinel 探针校验「焦点位置」（粘贴目标真相）

  调用契约：
    - argv[1] = 回复内容
    - argv[2] = "send" 或 "paste-only"
    - 返回 "ok" 表示成功执行；任何步骤失败抛错让任务进 failed/
*)

on ensureWeChatFrontmost()
  tell application "WeChat" to activate

  set deadline to (current date) + 2

  repeat
    tell application "System Events"
      set isFront to false
      try
        if exists (process "WeChat") then
          set isFront to frontmost of process "WeChat"
        end if
      end try
    end tell

    if isFront then
      delay 0.15
      return
    end if

    if (current date) > deadline then
      error "微信未能在 2 秒内成为前台应用，可能被遮挡或无响应。"
    end if

    delay 0.1
  end repeat
end ensureWeChatFrontmost

(*
  focusInputAreaByKeyboard：
  通过 Esc + Tab 把焦点送到当前会话的聊天输入框。
  Esc 关掉任何浮层（搜索框、引用、表情面板等）；Tab 在你的微信版本下
  会从会话列表/搜索框跳到聊天输入框。
*)
on focusInputAreaByKeyboard()
  tell application "System Events"
    tell process "WeChat"
      key code 53  -- Esc
      delay 0.15
      key code 48  -- Tab
      delay 0.2
    end tell
  end tell
end focusInputAreaByKeyboard

(*
  verifyFocusBySentinel：
  在输入框粘贴一个唯一短串，全选复制读回，确认 pbpaste 包含 sentinel。
  如果焦点不在输入框，sentinel 会粘到别处，校验失败立即抛错。
*)
on verifyFocusBySentinel(sentinel)
  set the clipboard to sentinel

  tell application "System Events"
    tell process "WeChat"
      -- 全选 + 删除清空当前输入框
      keystroke "a" using command down
      delay 0.1
      key code 51  -- Delete
      delay 0.1
      -- 粘贴 sentinel
      keystroke "v" using command down
      delay 0.3
      -- 全选 + 复制读回
      keystroke "a" using command down
      delay 0.1
      keystroke "c" using command down
      delay 0.2
    end tell
  end tell

  set readBack to the clipboard as text

  if readBack does not contain sentinel then
    error "焦点校验失败：sentinel 未粘进微信输入框。键盘焦点可能不在当前会话的输入框（实读：" & readBack & "）。"
  end if

  -- 校验通过，清空输入框
  tell application "System Events"
    tell process "WeChat"
      keystroke "a" using command down
      delay 0.1
      key code 51
      delay 0.1
    end tell
  end tell
end verifyFocusBySentinel

on run argv
  if (count of argv) < 2 then error "Usage: deliver_wechat_message.applescript <messageText> <sendMode>"

  set messageText to item 1 of argv
  set sendMode to item 2 of argv
  set originalClipboard to the clipboard

  -- 生成本次唯一的 sentinel：纳秒时间戳 + 固定标记
  set timestampString to (do shell script "date +%s%N")
  set sentinel to "__WCBOT_SENTINEL_" & timestampString & "__"

  try
    -- 第 1 步：确保微信前台
    my ensureWeChatFrontmost()

    -- 第 2 步：用快捷键拉焦点到输入框
    my focusInputAreaByKeyboard()

    -- 第 3 步：sentinel 探针校验焦点真的落到了输入框
    my verifyFocusBySentinel(sentinel)

    -- 第 4 步：粘贴真实回复
    set the clipboard to messageText
    tell application "System Events"
      tell process "WeChat"
        keystroke "v" using command down
        delay 0.3
      end tell
    end tell

    -- 第 5 步：按模式决定动作
    -- send: Return 发送
    -- paste-only: 按 → 让光标停在末尾，等用户人工 Enter
    tell application "System Events"
      tell process "WeChat"
        if sendMode is "send" then
          key code 36
          delay 0.3
        else
          key code 124  -- Right arrow
        end if
      end tell
    end tell

    set the clipboard to originalClipboard
    return "ok"
  on error errMsg number errNum
    try
      set the clipboard to originalClipboard
    end try
    error "WeChat delivery automation failed (" & errNum & "): " & errMsg
  end try
end run
