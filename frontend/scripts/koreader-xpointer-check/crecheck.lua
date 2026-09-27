-- Opens an EPUB in KOReader's crengine, headless. Run from KOReader's
-- lib/koreader directory with its bundled LuaJIT:
--   ./luajit crecheck.lua <book.epub> pages
--   ./luajit crecheck.lua <book.epub> xps <page> [page...]   XPointer at each page top
--   ./luajit crecheck.lua <book.epub> span <from> <to> [...] text between XPointers
--   ./luajit crecheck.lua <book.epub> page <xpointer> [...]  page of each (-1 if invalid)
package.path = "?.lua;common/?.lua;frontend/?.lua;" .. package.path
package.cpath = "?.so;common/?.so;" .. package.cpath
require("setupkoenv")
require("dbg"):turnOff()
local logger = require("logger")
logger:setLevel(logger.levels.err)
local DataStorage = require("datastorage")
G_defaults = require("luadefaults"):open(DataStorage:getDataDir() .. "/defaults.xpcheck.lua")
G_reader_settings = require("luasettings"):open(DataStorage:getDataDir() .. "/settings.xpcheck.lua")
einkfb = require("ffi/framebuffer") -- luacheck: ignore
einkfb.dummy = true -- luacheck: ignore
local Device = require("device")
Device.screen:init()
require("document/canvascontext"):init(Device)
Device.input.dummy = true

local doc = require("document/documentregistry"):openDocument(arg[1])
doc:render()
local cmd = arg[2]
if cmd == "pages" then
  print("RESULT", doc:getPageCount())
elseif cmd == "xps" then
  for i = 3, #arg do
    print("RESULT", arg[i], doc:getPageXPointer(tonumber(arg[i])))
  end
elseif cmd == "page" then
  for i = 3, #arg do
    local ok = doc:isXPointerInDocument(arg[i])
    print("RESULT", arg[i], ok and doc:getPageFromXPointer(arg[i]) or -1)
  end
elseif cmd == "span" then
  for i = 3, #arg, 2 do
    local text = doc:getTextFromXPointers(arg[i], arg[i + 1], false) or ""
    print("RESULT", arg[i], (text:gsub("%s+", " ")))
  end
end
doc:close()
