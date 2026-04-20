on run argv
  if (count of argv) < 2 then error "Usage: deliver_wechat_message.applescript <messageText> <sendMode>"

  set messageText to item 1 of argv
  set sendMode to item 2 of argv
  set originalClipboard to the clipboard

  try
    tell application "WeChat"
      activate
    end tell

    delay 0.2

    tell application "System Events"
      if UI elements enabled is false then error "System Events 未获得辅助功能权限，请在系统设置中授权。"
      if not (exists process "WeChat") then error "未检测到 WeChat 进程，请先登录并打开微信桌面版。"

      tell process "WeChat"
        set frontmost to true

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
    error "WeChat delivery automation failed (" & errNum & "): " & errMsg
  end try
end run
