#Tests of the hotkey combos patch (Godot 4.1, headless).
#Copy this test/ folder to the root of the patched PNGTuber-Plus project, then:
#  godot --headless --path . res://test/run.tscn
#Exit code 0 and the line "TOTAL n FAILS 0" mean success. The key states are simulated
#(dictionaries like the ones the native BackgroundInputCapture node sends); no real key press.
extends Node

var fails = 0
var total = 0

func check(cond, msg):
	total += 1
	if cond:
		print("ok   ", msg)
	else:
		fails += 1
		print("FAIL ", msg)

func _ready():
	var probe = load("res://test/main_probe.gd").new()
	var mock = load("res://test/mock_settings.gd").new()
	probe.settingsMenu = mock
	probe.fileSystemOpen = false
	
	#Scripts under test compile with the autoloads present
	for p in ["res://main_scenes/main.gd", "res://ui_scenes/spriteEditMenu/sprite_viewer.gd", "res://ui_scenes/settings/settings_menu.gd"]:
		var s = load(p)
		check(s != null and s.can_instantiate(), "compile " + p)
	
	unit(probe)
	costume_flow(probe, mock)
	sprite_flow(probe)
	label_flow()
	
	print("TOTAL ", total, " FAILS ", fails)
	get_tree().quit(1 if fails > 0 else 0)

func unit(probe):
	check(probe.keyCombos({KEY_P: true}) == ["P"], "P alone -> [P]")
	check(probe.keyCombos({KEY_CTRL: true, KEY_P: true}) == ["Ctrl+P"], "Ctrl+P")
	check(probe.keyCombos({KEY_P: true, KEY_SHIFT: true, KEY_CTRL: true}) == ["Ctrl+Shift+P"], "order independent -> Ctrl+Shift+P")
	check(probe.keyCombos({KEY_ALT: true, KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true}) == ["Ctrl+Shift+Alt+P"], "three modifiers")
	check(probe.keyCombos({KEY_META: true, KEY_P: true}) == ["Meta+P"], "Meta+P")
	check(probe.keyCombos({KEY_MASK_META: true, KEY_P: true}) == ["Meta+P"], "Windows key (KEY_MASK_META, as sent by the Windows DLL) + P -> Meta+P")
	check(probe.keyCombos({KEY_MASK_META: true}) == [] and probe.keyCombos({KEY_MASK_META: true}, true) == ["Meta"], "Windows key alone -> nothing (legacy list: Meta)")
	check(probe.keyCombos({KEY_CTRL: true, KEY_MASK_META: true, KEY_META: true, KEY_P: true}) == ["Ctrl+Meta+P"], "Meta reported twice -> single Meta")
	check(probe.keyCombos({KEY_CTRL: true}) == [], "Ctrl alone -> nothing")
	check(probe.keyCombos({KEY_CTRL: true, KEY_SHIFT: true}) == [], "Ctrl+Shift alone -> nothing")
	check(probe.keyCombos({KEY_CTRL: true}, true) == ["Ctrl"], "legacy: Ctrl alone -> [Ctrl]")
	check(probe.keyCombos({KEY_CTRL: true, KEY_SHIFT: true}, true) == ["Ctrl", "Shift"], "legacy: Ctrl+Shift alone -> [Ctrl, Shift]")
	check(probe.keyCombos({KEY_CTRL: false, KEY_P: true}) == ["P"], "released modifier ignored")
	check(probe.keyCombos({KEY_P: false}) == [] and probe.keyCombos({}, true) == [], "nothing held -> empty")
	check(!probe.keyCombos({KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true}).has("Ctrl+P"), "Ctrl+P not fired by Ctrl+Shift+P")
	check(!probe.keyCombos({KEY_CTRL: true, KEY_P: true}).has("Ctrl+Shift+P"), "Ctrl+Shift+P not fired by Ctrl+P")
	check(!probe.keyCombos({KEY_CTRL: true, KEY_P: true}).has("P"), "plain P not fired by Ctrl+P (exact match)")
	check(probe.keyCombos({KEY_P: true, KEY_O: true, KEY_CTRL: true}) == ["Ctrl+P", "Ctrl+O"], "two regular keys under Ctrl")
	check(probe.keyCombos({1: true}) == ["Keycode1"], "mouse button code 1 keeps the Keycode1 name")
	check(probe.keyCombos({1: true, KEY_CTRL: true}) == ["Ctrl+Keycode1"], "Ctrl + mouse button")
	check(probe.keyCombos({KEY_F1: true, KEY_SHIFT: true}) == ["Shift+F1"], "Shift+F1")
	#Plain keys: identical strings to the previous implementation (saved hotkeys keep matching)
	var codes = []
	for c in range(KEY_A, KEY_Z + 1):
		codes.append(c)
	for c in range(KEY_0, KEY_9 + 1):
		codes.append(c)
	codes.append_array([KEY_F1, KEY_F5, KEY_F12, KEY_SPACE, KEY_ESCAPE, KEY_ENTER, KEY_TAB, KEY_UP, KEY_LEFT, KEY_BACKSPACE, KEY_COMMA, KEY_PERIOD, KEY_SLASH, KEY_MINUS, KEY_EQUAL, KEY_PLUS, KEY_KP_0, KEY_KP_ENTER, 1, 2, 8, 9, 112, 160])
	var same = true
	for c in codes:
		var old = OS.get_keycode_string(c) if !OS.get_keycode_string(c).strip_edges().is_empty() else "Keycode" + str(c)
		if probe.keyCombos({c: true}) != [old]:
			same = false
			print("   differs for ", c, ": ", probe.keyCombos({c: true}), " vs ", [old])
	check(same, "plain key strings identical to the old OS.get_keycode_string expression (" + str(codes.size()) + " codes)")
	print("   names: ", probe.keyCombos({KEY_PLUS: true}), probe.keyCombos({KEY_CTRL: true, KEY_PLUS: true}), probe.keyCombos({KEY_F1: true}), probe.keyCombos({KEY_SPACE: true}))
	check(probe.firstHotkey(["Ctrl", "Shift"]) == "", "firstHotkey: only modifiers -> empty")
	check(probe.firstHotkey(["Ctrl", "Ctrl+P"]) == "Ctrl+P", "firstHotkey picks the combo")
	check(probe.firstHotkey(["P"]) == "P", "firstHotkey plain")
	check(probe.firstHotkey([]) == "", "firstHotkey empty")

func feed(probe, state):
	probe._on_background_input_capture_bg_key_pressed(null, state)

func costume_flow(probe, mock):
	var pressed = []
	var emptied = []
	probe.connect("pressedKey", func(): pressed.append(1))
	probe.connect("emptiedCapture", func(): emptied.append(1))
	
	#A: bind costume 3 with Ctrl, then Shift, then P; Ctrl released before P
	probe.costumeKeys = ["1","2","3","4","5","6","7","8","9","0"]
	mock.awaitingCostumeInput = 2
	feed(probe, {})
	feed(probe, {KEY_CTRL: true})
	check(probe.costumeKeys[2] == "3" and pressed.size() == 0, "A: Ctrl alone does not bind")
	feed(probe, {KEY_CTRL: true, KEY_SHIFT: true})
	check(probe.costumeKeys[2] == "3" and pressed.size() == 0, "A: Ctrl+Shift alone does not bind")
	feed(probe, {KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true})
	check(probe.costumeKeys[2] == "Ctrl+Shift+P" and pressed.size() == 1, "A: Ctrl+Shift+P bound to costume 3")
	check(Saving.settings["costumeKeys"][2] == "Ctrl+Shift+P", "A: saved in Saving.settings (string, same field)")
	feed(probe, {KEY_CTRL: false, KEY_SHIFT: true, KEY_P: true})
	check(probe.costumeKeys[2] == "Ctrl+Shift+P" and pressed.size() == 1, "A: releasing Ctrl first does not rebind")
	feed(probe, {KEY_CTRL: false, KEY_SHIFT: false, KEY_P: false})
	check(emptied.size() >= 2, "A: emptiedCapture emitted on release")
	mock.awaitingCostumeInput = -1
	
	#B: plain key binding still works
	mock.awaitingCostumeInput = 4
	pressed.clear()
	feed(probe, {KEY_P: true})
	check(probe.costumeKeys[4] == "P" and pressed.size() == 1, "B: plain P binds as before")
	feed(probe, {KEY_P: false})
	mock.awaitingCostumeInput = -1
	
	#C: runtime matching
	probe.costumeKeys = ["Ctrl+Shift+P", "P", "Ctrl+P", "Shift", "null", "6", "7", "8", "9", "0"]
	probe.costumeCalls.clear()
	feed(probe, {KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true})
	check(probe.costumeCalls == [1], "C: Ctrl+Shift+P -> costume 1 only")
	feed(probe, {KEY_CTRL: false, KEY_SHIFT: false, KEY_P: false})
	probe.costumeCalls.clear()
	feed(probe, {KEY_CTRL: true, KEY_P: true})
	check(probe.costumeCalls == [3], "C: Ctrl+P -> costume 3 only")
	feed(probe, {KEY_CTRL: false, KEY_P: false})
	probe.costumeCalls.clear()
	feed(probe, {KEY_P: true})
	check(probe.costumeCalls == [2], "C: P -> costume 2 only")
	feed(probe, {KEY_P: false})
	probe.costumeCalls.clear()
	feed(probe, {KEY_SHIFT: true})
	check(probe.costumeCalls == [4], "C: legacy hotkey 'Shift' (modifier alone) still fires")
	feed(probe, {KEY_SHIFT: false})
	probe.costumeCalls.clear()
	feed(probe, {KEY_SHIFT: true, KEY_P: true})
	check(probe.costumeCalls == [], "C: Shift+P fires nothing")
	feed(probe, {KEY_SHIFT: false, KEY_P: false})
	probe.costumeCalls.clear()
	feed(probe, {KEY_5: true})
	check(probe.costumeCalls == [], "C: unbound key fires nothing")
	feed(probe, {KEY_6: true, KEY_5: false})
	check(probe.costumeCalls == [6], "C: plain '6' -> costume 6")
	feed(probe, {KEY_6: false})
	
	#D: click outside the settings menu cancels the capture (previous behaviour)
	probe.costumeKeys = ["1","2","3","4","5","6","7","8","9","0"]
	mock.awaitingCostumeInput = 0
	mock.hasMouse = false
	pressed.clear()
	feed(probe, {1: true})
	check(probe.costumeKeys[0] == "1" and pressed.size() == 1, "D: mouse click outside cancels, hotkey unchanged")
	feed(probe, {1: false})
	mock.awaitingCostumeInput = -1
	
	#E: file dialog open -> nothing
	probe.costumeCalls.clear()
	probe.fileSystemOpen = true
	feed(probe, {KEY_1: true})
	check(probe.costumeCalls == [], "E: ignored while a file dialog is open")
	probe.fileSystemOpen = false
	feed(probe, {KEY_1: false})

func sprite_flow(probe):
	var viewer = load("res://ui_scenes/spriteEditMenu/sprite_viewer.gd").new()
	var vis = Node2D.new(); vis.name = "VisToggle"
	var btn = Button.new(); btn.name = "setToggle"
	var lbl = Label.new(); lbl.name = "Label"
	viewer.add_child(vis); vis.add_child(btn); btn.add_child(lbl)
	var sprite = load("res://test/mock_sprite.gd").new()
	Global.main = probe
	Global.heldSprite = sprite
	
	viewer._on_set_toggle_pressed()
	check(lbl.text == "toggle: AWAITING INPUT", "S: label shows AWAITING INPUT")
	probe.bgInputSprite(null, {})
	probe.bgInputSprite(null, {KEY_CTRL: true})
	check(sprite.toggle == "null", "S: Ctrl alone is not accepted as toggle")
	probe.bgInputSprite(null, {KEY_CTRL: true, KEY_SHIFT: true})
	check(sprite.toggle == "null", "S: Ctrl+Shift alone is not accepted")
	probe.bgInputSprite(null, {KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true})
	check(sprite.toggle == "Ctrl+Shift+P", "S: toggle = Ctrl+Shift+P")
	check(lbl.text == "toggle: \"Ctrl+Shift+P\"", "S: label readable: " + lbl.text)
	#Further states do not change the toggle any more
	probe.bgInputSprite(null, {KEY_CTRL: false, KEY_SHIFT: true, KEY_P: true})
	check(sprite.toggle == "Ctrl+Shift+P", "S: toggle not rewritten afterwards")
	probe.bgInputSprite(null, {})
	
	#Sprites listen on spriteVisToggles(keys) and test keys.has(toggle)
	var fired = []
	probe.spriteVisToggles.connect(func(keys): fired.append(keys.has(sprite.toggle)))
	probe.bgInputSprite(null, {KEY_CTRL: true, KEY_SHIFT: true, KEY_P: true})
	probe.bgInputSprite(null, {KEY_CTRL: true, KEY_SHIFT: false, KEY_P: true})
	probe.bgInputSprite(null, {KEY_CTRL: false, KEY_SHIFT: false, KEY_P: true})
	probe.bgInputSprite(null, {KEY_CTRL: true, KEY_SHIFT: true, KEY_ALT: true, KEY_P: true})
	check(fired == [true, false, false, false], "S: only the exact combo matches: " + str(fired))
	
	#Plain toggle capture still works (old saves / old behaviour)
	sprite.toggle = "null"
	probe.bgInputSprite(null, {})
	viewer._on_set_toggle_pressed()
	probe.bgInputSprite(null, {})
	probe.bgInputSprite(null, {KEY_P: true})
	check(sprite.toggle == "P", "S: plain P captured as 'P'")
	#Old saved toggle strings keep matching
	sprite.toggle = "Ctrl"
	fired.clear()
	probe.bgInputSprite(null, {})
	probe.bgInputSprite(null, {KEY_CTRL: true})
	check(fired == [true], "S: legacy toggle 'Ctrl' still fires on Ctrl alone")
	viewer.free()
	sprite.free()

func label_flow():
	var menu = load("res://ui_scenes/settings/settings_menu.gd").new()
	Global.main.costumeKeys = ["1","2","3","4","5","6","7","8","9","Ctrl+Shift+P"]
	check(menu.costumeLabel(1) == "costume 1 key: \"1\"", "L: short key label unchanged: " + menu.costumeLabel(1))
	check(menu.costumeLabel(10) == "costume 10: \"Ctrl+Shift+P\"", "L: long combo label: " + menu.costumeLabel(10))
	menu.free()
