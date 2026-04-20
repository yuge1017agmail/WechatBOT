-- argv:
-- 1 chatName
-- 2 messageText
-- 3 sendMode
-- 4 lastMessage
-- 5 isGroup ("true"/"false")
-- 6 sender
on run argv
  if (count of argv) < 6 then error "Usage: send_wechat_message.applescript <chatName> <messageText> <sendMode> <lastMessage> <isGroup> <sender>"

  set chatName to item 1 of argv
  set messageText to item 2 of argv
  set sendMode to item 3 of argv
  set lastMessage to item 4 of argv
  set isGroup to item 5 of argv
  set sender to item 6 of argv

  set originalClipboard to the clipboard

  try
    tell application "WeChat"
      activate
    end tell

    delay 0.6

    tell application "System Events"
      if UI elements enabled is false then error "System Events 未获得辅助功能权限，请在系统设置中授权。"
      if not (exists process "WeChat") then error "未检测到 WeChat 进程，请先登录并打开微信桌面版。"

      tell process "WeChat"
        set frontmost to true

        keystroke "f" using command down
        delay 0.4

        keystroke "a" using command down
        delay 0.1
        key code 51
        delay 0.1

        set the clipboard to chatName
        keystroke "v" using command down
        delay 0.8

        key code 36
        delay 0.6

        set windowText to (entire contents of front window) as string
        if windowText does not contain chatName then error "会话标题校验失败: " & chatName
        if windowText does not contain lastMessage then error "最近消息校验失败: " & lastMessage
        if isGroup is "true" and sender is not "" then
          if windowText does not contain sender then error "群聊发送人校验失败: " & sender
        end if

        set the clipboard to messageText
        keystroke "v" using command down
        delay 0.3

        if sendMode is "send" then
          key code 36
        end if
      end tell
    end tell

    set the clipboard to originalClipboard
    return "ok"
  on error errMsg number errNum
    try
      set the clipboard to originalClipboard
    end try
    error "WeChat AppleScript automation failed (" & errNum & "): " & errMsg
  end try
end run
