-- 中文输入方式切换（双拼 ⇄ 五笔）
--
-- 监听 Ctrl+Shift+Space：先上屏原始输入编码（与 Ctrl+Space
-- 中英切换行为一致），再在 double_pinyin_flypy 和 wubi98 间 toggle。

local function processor(key, env)
  -- 忽略按键释放事件
  if key:release() then
    return 2 -- kNoop
  end
  -- 只拦截 Ctrl+Shift+Space
  if key:repr() ~= "Control+Shift+space" then
    return 2 -- kNoop
  end

  local engine = env.engine
  local ctx = engine.context

  -- 有未上屏输入时，先上屏原始输入编码
  if ctx:is_composing() then
    local text = ctx.input
    if text and text ~= "" then
      engine:commit_text(text)
    end
    ctx:clear()
  end

  -- 在双拼和五笔间 toggle
  local current = engine.schema.schema_id
  if current == "double_pinyin_flypy" then
    engine:apply_schema(Schema("wubi98"))
  else
    engine:apply_schema(Schema("double_pinyin_flypy"))
  end

  return 1 -- kAccepted
end

return processor
