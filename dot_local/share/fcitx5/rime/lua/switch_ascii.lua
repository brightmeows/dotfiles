-- 中英切换时上屏当前输入
--
-- 解决问题：key_binder toggle ascii_mode 切换时，preedit 卡在
-- inline_preedit 状态不上屏；ascii_composer/switch_key 的
-- commit_text/commit_code 对组合键（Ctrl+Space）无效。
--
-- 相关 issue:
--   https://github.com/rime/squirrel/issues/957
--   https://github.com/rime/librime/issues/631
--
-- 行为：按 Ctrl+Space 时，若有未上屏输入，先上屏原始输入编码
-- （commit_code 语义：上屏用户实际按下的字母），再切换 ascii_mode。

local function processor(key, env)
  -- 忽略按键释放事件，只处理按下
  if key:release() then
    return 2 -- kNoop
  end
  -- 只拦截 Ctrl+Space
  if key:repr() ~= "Control+space" then
    return 2 -- kNoop
  end

  local engine = env.engine
  local ctx = engine.context

  -- 有未上屏输入时，先上屏原始输入编码（用户实际按下的字母）
  if ctx:is_composing() then
    local text = ctx.input
    if text and text ~= "" then
      engine:commit_text(text)
    end
    ctx:clear()
  end

  -- 切换中英文模式
  ctx:set_option("ascii_mode", not ctx:get_option("ascii_mode"))

  return 1 -- kAccepted
end

return processor
