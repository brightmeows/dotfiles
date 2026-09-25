--- @since 26.9.1

-- enter-archive.yazi：回车 = 进压缩包浏览（解压到缓存），o --extract = 整包解压到包旁。
-- 目录与普通文件一律转发默认 open 行为，与未绑定前完全一致（默认 o 与 <Enter> 均为 open）。
--
-- 后端分工（GBK 中文文件名不乱码是硬约束）：
--   unar   —— 主后端：自动检测文件名编码；实测支持 7z 分卷(.7z.NNN)与 zip 分卷(.zNN/.zip 双入口)
--   bsdtar —— 仅兜 .zst/.tzst（unar 1.10 不支持 zstd；zst 包来自 Linux 生态，文件名 UTF-8 无 GBK 风险）
-- yazi.toml 里 zip 的 unar prepend_rules 是绕过键位 open 的兜底，后端必须与本插件同为 unar，
-- 改后端需同步两处（注释互指）。
--
-- 缓存（不自动清理，手动 rm -rf ~/.cache/yazi/archive/）：
--   archive/<hash(首卷路径)>/        解压出的内容
--   archive/<hash(首卷路径)>.meta    全族聚合键：每卷 路径|字节数|mtime，任何一卷变动即失效重建
--   发布走 tmp 目录 + rename（并发首建竞态接受，损坏时删缓存恢复）
--   内容恰有一个子目录时直接进入该子目录
--   注：文件名含 '|' 时聚合键理论上可歧义，仅影响同一首卷的失效判定，影响可忽略
--
-- 分卷：识别 .7z.NNN / .zNN / .partN.rar / .rNN 族；泛数字后缀（如 .001）需同族 ≥2 个且首卷
-- 带 7z 魔数，避免把 data.2024 这类数据文件误判为包。任意一卷触发均自动定位首卷，不产生拼接
-- 垃圾。split(1) 的 .aa/.bb 拼接不在识别范围（非目标）。
-- 加密包：unar 无 tty 立即报错（实测 exit 2），捕获后提示去终端 unar -p（yazi 内不做密码输入）。
-- 选区语义：o 有选区且全部为压缩包时逐个解压；选区混有非压缩包时整体交回默认 open（维持旧行为）。
-- 回车有选区时始终作用于悬停项（进包是单目标动作）。

local SEVEN_Z_MAGIC = "\55\122\188\175\39\28" -- 7z 卷首魔数 37 7A BC AF 27 1C

local ARCHIVE_SUFFIXES = {
	"%.zip$",
	"%.tar$",
	"%.gz$",
	"%.tgz$",
	"%.bz2$",
	"%.tbz$",
	"%.tbz2$",
	"%.xz$",
	"%.txz$",
	"%.7z$",
	"%.rar$",
	"%.zst$",
	"%.tzst$",
}

local function notify(content, level)
	ya.notify({ title = "Archive", content = content, level = level or "info", timeout = 5 })
end

-- 把任意字符串转成 Lua 模式里的字面量
local function magic(s) return (s:gsub("%W", "%%%0")) end

local function read_head(path, n)
	local f = io.open(path, "rb")
	if not f then return nil end
	local data = f:read(n)
	f:close()
	return data
end

local function read_file(path)
	local f = io.open(path, "rb")
	if not f then return nil end
	local data = f:read("*a")
	f:close()
	return data
end

-- 识别分卷族。返回：
--   { pat, alt?, need_two?, sniff? }  分卷族（pat 捕获卷序号，alt 为主卷文件名）
--   { single = true }                 普通单文件压缩包
--   nil                               不是压缩包
local function detect_family(name)
	local base = name:match("^(.*)%.7z%.%d+$")
	if base then return { pat = "^" .. magic(base) .. "%.7z%.(%d+)$" } end

	base = name:match("^(.*)%.z%d+$")
	if base then return { pat = "^" .. magic(base) .. "%.z(%d+)$", alt = base .. ".zip" } end

	base = name:match("^(.*)%.part%d+%.rar$")
	if base then return { pat = "^" .. magic(base) .. "%.part(%d+)%.rar$" } end

	base = name:match("^(.*)%.r%d+$")
	if base and not name:match("%.rar$") then
		return { pat = "^" .. magic(base) .. "%.r(%d+)$", alt = base .. ".rar" }
	end

	-- 主卷自身也可能被回车（zip -s 的 .zip 在族尾、老式 rar 的 .rar 在族首）
	base = name:match("^(.*)%.zip$")
	if base then return { pat = "^" .. magic(base) .. "%.z(%d+)$", alt = name } end

	base = name:match("^(.*)%.rar$")
	if base then return { pat = "^" .. magic(base) .. "%.r(%d+)$", alt = name } end

	-- 泛数字后缀：需同族 ≥2 且首卷为 7z 魔数（sniff），防止误判 data.2024 之类
	base = name:match("^(.*)%.(%d%d+)$")
	if base then return { pat = "^" .. magic(base) .. "%.(%d%d+)$", need_two = true, sniff = true } end

	for _, s in ipairs(ARCHIVE_SUFFIXES) do
		if name:match(s) then return { single = true } end
	end
	return nil
end

local function member_cmp(a, b)
	if a.num ~= b.num then return a.num < b.num end
	return a.name < b.name
end

-- 解析族成员，返回 (卷名列表按序, 首卷名) 或 (nil, nil, 错误|"not-family")
local function resolve_family(dir, fam, hovered)
	if fam.single then return { hovered }, hovered end

	local files, err = fs.read_dir(Url(dir), {})
	if not files then return nil, nil, "读取目录失败：" .. tostring(err) end

	local members = {}
	for _, f in ipairs(files) do
		local num = f.name:match(fam.pat)
		if num then
			members[#members + 1] = { name = f.name, num = tonumber(num) or 0 }
		elseif fam.alt and f.name == fam.alt then
			members[#members + 1] = { name = f.name, num = -1 }
		end
	end
	if #members == 0 then return nil, nil, "未找到同族分卷" end
	if fam.need_two and #members < 2 then return nil, nil, "not-family" end

	table.sort(members, member_cmp)

	if fam.sniff then
		local head = read_head(tostring(dir) .. "/" .. members[1].name, 6)
		if head ~= SEVEN_Z_MAGIC then return nil, nil, "not-family" end
	end

	local names = {}
	for _, m in ipairs(members) do names[#names + 1] = m.name end
	return names, members[1].name
end

local function cache_root()
	local base = os.getenv("XDG_CACHE_HOME") or ((os.getenv("HOME") or "/tmp") .. "/.cache")
	return base .. "/yazi/archive"
end

-- 全族聚合键（问题17）：每卷 路径|字节数|mtime
local function family_meta(dir, names)
	local parts = {}
	for _, n in ipairs(names) do
		local p = dir .. "/" .. n
		local cha = fs.cha(Url(p))
		if not cha then return nil end
		parts[#parts + 1] = p .. "|" .. cha.len .. "|" .. tostring(cha.mtime)
	end
	return table.concat(parts, "\n")
end

local function run_extract(backend, archive, out_dir)
	local out, err
	if backend == "bsdtar" then
		out, err = Command("bsdtar"):arg({ "-xf", archive, "-C", out_dir }):output()
	else
		out, err = Command("unar"):arg({ "-q", "-f", "-o", out_dir, archive }):output()
	end
	if not out then return false, tostring(err) end
	if not out.status.success then
		local msg = out.stderr
		if msg == "" or msg == nil then msg = out.stdout end
		return false, msg or ("exit " .. tostring(out.status.code))
	end
	return true
end

local function trim_msg(msg)
	msg = tostring(msg or ""):gsub("^%s+", ""):gsub("%s+$", "")
	msg = msg:gsub("[\r\n]+", " / ")
	if #msg > 160 then msg = msg:sub(1, 160) .. "..." end
	return msg
end

local function is_password_error(msg)
	local low = tostring(msg or ""):lower()
	return low:find("password") ~= nil or low:find("encrypted") ~= nil
end

local function notify_extract_error(backend, msg)
	if is_password_error(msg) then
		notify("加密包需要密码，请在终端执行：unar -p <文件>", "warn")
	else
		notify(backend .. " 解压失败：" .. trim_msg(msg), "error")
	end
end

-- 视图收敛：内容恰有一个子目录时直接进入该子目录
local function view_of(content)
	local ok, res = pcall(function()
		local files = fs.read_dir(Url(content), {})
		if files and #files == 1 and files[1].cha.is_dir then return content .. "/" .. files[1].name end
		return content
	end)
	if not ok then
		ya.err("enter-archive: view_of error: " .. tostring(res))
		return content
	end
	return res
end

-- 原子发布（问题14）：先落 meta 临时文件，再替换内容目录，最后换 meta
local function publish(tmp, content, meta_path, meta)
	if meta then fs.write(Url(tmp .. ".meta"), meta) end
	if fs.cha(Url(content)) then fs.remove("dir_all", Url(content)) end
	fs.remove("file", Url(meta_path))
	local ok, err = fs.rename(Url(tmp), Url(content))
	if not ok then return false, err end
	if meta then fs.rename(Url(tmp .. ".meta"), Url(meta_path)) end
	return true
end

local get_state = ya.sync(function()
	local tab = cx.active
	local h = tab.current.hovered
	local sel = {}
	for _, u in pairs(tab.selected) do sel[#sel + 1] = tostring(u) end
	return {
		hovered = h and { path = tostring(h.url), name = h.name } or nil,
		sel = sel,
	}
end)

local function basename(path) return path:match("([^/]+)$") end

local function parent_of(path)
	local dir = path:match("^(.*)/[^/]+$")
	if dir == nil or dir == "" then return "/" end
	return dir
end

local function backend_for(canonical)
	if canonical:match("%.zst$") or canonical:match("%.tzst$") then return "bsdtar" end
	return "unar"
end

-- o --extract：逐个解压选中的压缩包到各自所在目录（问题13）
local function do_extract(targets)
	local done, failed, names = 0, {}, {}
	for _, p in ipairs(targets) do
		local name = basename(p)
		local fam = detect_family(name)
		if fam then
			local dir = parent_of(p)
			local members, canonical, err = resolve_family(dir, fam, name)
			if members then
				local backend = backend_for(canonical)
				local ok, msg = run_extract(backend, dir .. "/" .. canonical, dir)
				if ok then
					done = done + 1
					names[#names + 1] = name
				else
					local why = is_password_error(msg) and "需要密码，请在终端执行 unar -p" or trim_msg(msg)
					failed[#failed + 1] = name .. "（" .. why .. "）"
				end
			elseif err ~= "not-family" then
				failed[#failed + 1] = name .. "（" .. err .. "）"
			end
		end
	end

	if #failed > 0 then
		notify(
			string.format("解压完成 %d 个，失败 %d 个：%s", done, #failed, table.concat(failed, "；")),
			"error"
		)
	elseif #names == 1 then
		notify("解压完成：" .. names[1], "info")
	elseif #names > 1 then
		notify(string.format("解压完成：%d 个压缩包", #names), "info")
	end
end

-- 回车：进包到缓存（问题3/17/14）
local function do_enter(h)
	local fam = detect_family(h.name)
	if not fam then
		ya.emit("open", {})
		return
	end

	local dir = parent_of(h.path)
	local members, canonical, err = resolve_family(dir, fam, h.name)
	if not members then
		if err == "not-family" then
			ya.emit("open", {})
		else
			notify(err, "error")
		end
		return
	end

	local backend = backend_for(canonical)
	local root = cache_root()
	fs.create("dir_all", Url(root))

	local canonical_path = dir .. "/" .. canonical
	local key = ya.hash(canonical_path)
	local content = root .. "/" .. key
	local meta_path = content .. ".meta"
	local meta = family_meta(dir, members)

	if meta and read_file(meta_path) == meta and fs.cha(Url(content)) then
		ya.emit("cd", { Url(view_of(content)) })
		return
	end

	local tmpu, erru = fs.unique("dir", Url(root .. "/tmp-"))
	if not tmpu then
		notify("无法创建缓存临时目录：" .. tostring(erru), "error")
		return
	end
	local tmp = tostring(tmpu)

	local ok, msg = run_extract(backend, canonical_path, tmp)
	if not ok then
		fs.remove("dir_all", tmpu)
		notify_extract_error(backend, msg)
		return
	end

	local pub_ok, pub_err = publish(tmp, content, meta_path, meta)
	if not pub_ok then
		fs.remove("dir_all", tmpu)
		notify("发布缓存失败：" .. tostring(pub_err), "error")
		return
	end
	ya.emit("cd", { Url(view_of(content)) })
end

local function run(job)
	local extract = false
	if job and job.args then
		if job.args.extract then extract = true end
		for _, a in ipairs(job.args) do
			if a == "--extract" or a == "-x" or a == "extract" then extract = true end
		end
	end

	local st = get_state()
	if not st.hovered then return end

	if extract then
		local targets = #st.sel > 0 and st.sel or { st.hovered.path }
		-- 选区混有非压缩包：整体交回默认 open，维持旧的 o 语义
		local all_archives = true
		for _, p in ipairs(targets) do
			if not detect_family(basename(p)) then
				all_archives = false
				break
			end
		end
		if not all_archives then
			ya.emit("open", {})
			return
		end
		do_extract(targets)
	else
		do_enter(st.hovered)
	end
end

return {
	entry = function(_, job)
		local ok, err = pcall(run, job)
		if not ok then
			ya.err("enter-archive: " .. tostring(err))
			notify("enter-archive 内部错误：" .. trim_msg(tostring(err)), "error")
		end
	end,
}
