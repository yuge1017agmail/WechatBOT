on run argv
  if (count of argv) < 1 then error "Usage: prepare_wechat_chat.applescript <chatName>"

  set chatName to item 1 of argv
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
      end tell
    end tell

    set the clipboard to originalClipboard
    return "ok"
  on error errMsg number errNum
    try
      set the clipboard to originalClipboard
    end try
    error "WeChat prepare automation failed (" & errNum & "): " & errMsg
  end try
end run
