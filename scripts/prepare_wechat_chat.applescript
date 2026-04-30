(*
  prepare_wechat_chat.applescript (v3)
  职责：通过微信原生快捷键 Cmd+F 打开全局搜索、输入联系人名、选中第一条结果进入会话。
        本脚本 0 坐标点击，所有操作通过快捷键完成。

  调用契约：
    - argv[1] = 联系人名
    - 返回 "ok" 表示动作序列已执行（不保证切换成功，由上游 OCR 校验确认）
    - 任何步骤失败抛错

  上游 wechat-ui-send.ts 在调用本脚本前会先 OCR 检查当前会话，
  如果已经是目标会话，根本不会调用本脚本（避免重复切换的副作用）。
  调用本脚本后会再 OCR 校验一次，确认切换真的成功。
*)

(*
  ensureWeChatFrontmost：
  循环等待微信成为前台，最多 2 秒。
  确保后续 keystroke 都打到微信进程，而不是发起调用时的应用。
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

on run argv
  if (count of argv) < 1 then error "Usage: prepare_wechat_chat.applescript <chatName>"

  set chatName to item 1 of argv
  set originalClipboard to the clipboard

  try
    tell application "System Events"
      if UI elements enabled is false then error "System Events 未获得辅助功能权限，请在系统设置中授权。"
      if not (exists process "WeChat") then error "未检测到 WeChat 进程，请先登录并打开微信桌面版。"
    end tell

    -- 第 1 步：可靠激活微信
    my ensureWeChatFrontmost()

    -- 第 2 步：Esc 一次清掉可能残留的搜索/小窗状态
    tell application "System Events"
      tell process "WeChat"
        key code 53
        delay 0.15
      end tell
    end tell

    -- 第 3 步：Cmd+F 触发全局搜索（已验证：在你这版微信上稳定打开左上角全局搜索）
    tell application "System Events"
      tell process "WeChat"
        keystroke "f" using command down
        delay 0.3
      end tell
    end tell

    -- 第 4 步：把联系人名粘到搜索框（不用 keystroke 因为中文/特殊字符不稳）
    set the clipboard to chatName
    tell application "System Events"
      tell process "WeChat"
        -- 先全选删除，避免上次残留
        keystroke "a" using command down
        delay 0.1
        key code 51
        delay 0.1
        -- 粘贴
        keystroke "v" using command down
        delay 0.6
      end tell
    end tell

    -- 第 5 步：直接 Enter 进入默认选中的搜索结果
    -- 微信搜索框的行为：粘贴文字后，第一条联系人结果默认被高亮，
    -- 按 Enter 直接进入；不需要先 Down（按 Down 反而会把焦点跳到下一组群聊）。
    tell application "System Events"
      tell process "WeChat"
        key code 36  -- Return
        delay 0.6
      end tell
    end tell

    -- 第 6 步：再 Esc 一次确保关掉所有搜索浮层
    tell application "System Events"
      tell process "WeChat"
        key code 53
        delay 0.15
      end tell
    end tell

    -- 不在这里聚焦输入框；上游会先 OCR 校验，通过后由 deliver 脚本用 Tab 拉焦点

    set the clipboard to originalClipboard
    return "ok"
  on error errMsg number errNum
    try
      set the clipboard to originalClipboard
    end try
    error "WeChat prepare automation failed (" & errNum & "): " & errMsg
  end try
end run
