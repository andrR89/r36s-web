# tests/test_mkmanifest.py — manifest do emulador (hub): só ROMs, BIOS, arquivos de apoio e configs do RetroArch
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

SYSTEMS = b"<systemList><system><name>snes</name><path>/roms/snes/</path><extension>.7z</extension></system></systemList>"

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class T(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.src, "/etc/emulationstation/es_systems.cfg", SYSTEMS)
        touch(self.src, "/home/ark/.config/retroarch/retroarch-core-options.cfg", b"opt = 1")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b"<config/>")
        touch(self.src, "/usr/bin/emulationstation/resources/arrow.svg", b"<svg/>")
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList/>")
        touch(self.src, "/roms/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.src, "/roms/snes/Jogo (USA).srm", b"SRM")
        touch(self.src, "/roms/snes/images/Jogo (USA).png", b"PNG")
        touch(self.src, "/roms/bios/scph1001.bin", b"BIOS")
        touch(self.src, "/roms/snes/sub/dados.dat", b"DAT")
        touch(self.src, "/roms/snes/sub/Outro (USA).7z", b"ROM2")
        touch(self.src, "/roms/ports/Jogo.sh", b"#!/bin/sh")
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_only_player_files(self):
        self.assertEqual(sorted(self.m["files"]), sorted([
            "/home/ark/.config/retroarch/retroarch-core-options.cfg", "/roms/bios/scph1001.bin",
            "/roms/snes/Jogo (USA).7z", "/roms/snes/Jogo (USA).srm", "/roms/snes/sub/Outro (USA).7z"]))

    def test_deep_support_and_ports_left_out(self):
        self.assertNotIn("/roms/snes/sub/dados.dat", self.m["files"])
        self.assertNotIn("/roms/ports/Jogo.sh", self.m["files"])

    def test_retroarch_cfg_is_eager(self):
        f = self.m["files"]["/home/ark/.config/retroarch/retroarch-core-options.cfg"]
        self.assertEqual(f["kind"], "eager")
        self.assertEqual(self.blob[f["off"]:f["off"] + f["size"]], b"opt = 1")
        self.assertEqual(len(self.blob), 7)

    def test_rom_empty_bios_and_support_lazy(self):
        self.assertEqual(self.m["files"]["/roms/snes/Jogo (USA).7z"]["kind"], "empty")
        self.assertEqual(self.m["files"]["/roms/bios/scph1001.bin"], {"size": 4, "kind": "lazy", "url": "fs/roms/bios/scph1001.bin"})
        self.assertEqual(self.m["files"]["/roms/snes/Jogo (USA).srm"]["kind"], "lazy")

    def test_without_es_systems_fails(self):
        src = tempfile.mkdtemp()
        touch(src, "/roms/snes/Jogo.7z", b"R")
        with self.assertRaises(SystemExit):
            mkmanifest.build(src, tempfile.mkdtemp())

if __name__ == "__main__":
    unittest.main()
