# tests/test_drive_manifest.py — mkmanifest.py --drive-ids (índice da biblioteca no Google Drive)
# python3 -m unittest tests.test_drive_manifest
import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SYSTEMS = """<systemList><system><name>snes</name><path>/roms/snes/</path><extension>.7z .cue</extension></system>
<system><name>ports</name><path>/roms/ports/</path><extension>.sh</extension></system>
<system><name>n64</name><path>/roms/n64/</path><extension>.z64</extension></system></systemList>"""

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class DriveIds(unittest.TestCase):
    def setUp(self):
        self.src, self.out = tempfile.mkdtemp(), tempfile.mkdtemp()
        touch(self.src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b'<string name="ThemeSet" value="t" />')
        touch(self.src, "/usr/bin/emulationstation/resources/big.ttf", b"F" * (2 * 1024 * 1024))
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList><game><image>./images/Jogo.png</image></game></gameList>")
        touch(self.src, "/roms/snes/Jogo.7z", b"ROM")
        touch(self.src, "/roms/snes/Disco.cue", b'FILE "Disco.bin" BINARY')
        touch(self.src, "/roms/snes/Disco.bin", b"BIN")
        touch(self.src, "/roms/snes/Jogo.srm", b"SRM")
        touch(self.src, "/roms/snes/sub/Disco2.cue", b'FILE "Disco2.bin" BINARY')
        touch(self.src, "/roms/snes/sub/Disco2.bin", b"BIN2")
        touch(self.src, "/roms/ports/x.sh", b"#!/bin/sh")
        touch(self.src, "/roms/snes/images/Jogo.png", b"PNG")
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/roms/themes/t/bg.jpg", b"JPG")
        touch(self.src, "/roms/themes/t/_art/posters/snes.jpg", b"JPG")      # sistema com jogos
        touch(self.src, "/roms/themes/t/_art/posters/n64.jpg", b"JPG")       # no es_systems, mas sem jogos
        touch(self.src, "/roms/themes/t/_art/assets/sounds/snes.ogg", b"OGG")
        touch(self.src, "/roms/themes/outro/bg.jpg", b"JPG")                  # tema que não é o ativo
        # a pasta R36S do Drive = /roms; a listagem sai do mock (mesmo formato do rclone lsjson -R --hash)
        ls = subprocess.check_output([sys.executable, "-I", os.path.join(ROOT, "tests", "mock_drive.py"), "--lsjson", os.path.join(self.src, "roms")])
        self.ids = {e["Path"]: e["ID"] for e in json.loads(ls)}
        lsj = os.path.join(self.out, "ls.json")
        open(lsj, "wb").write(ls)
        self.lsj = lsj
        mkmanifest.build(self.src, self.out, mkmanifest.read_lsjson(lsj))
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))

    def test_roms_have_ids(self):
        f = self.m["files"]["/roms/snes/Jogo.7z"]
        self.assertEqual((f["kind"], f["id"]), ("empty", self.ids["snes/Jogo.7z"]))
        self.assertTrue(f["v"])   # md5 -> versão do cache

    def test_no_es_files(self):
        for p in self.m["files"]:
            self.assertFalse(p.startswith(("/usr/", "/etc/", "/roms/themes/", "/home/ark/.emulationstation")), p)
            self.assertFalse(p.endswith("gamelist.xml") or "/images/" in p, p)
        self.assertEqual(os.path.getsize(os.path.join(self.out, "eager.bin")), 0)

    def test_extra_keeps_sheet_tracks_and_saves(self):
        self.assertIn("/roms/snes/Disco.bin", self.m["files"])   # topo da pasta: no manifest
        self.assertIn("/roms/snes/sub/Disco2.bin", self.m["extra"])   # subpasta: só no extra
        self.assertNotIn("/roms/snes/sub/Disco2.bin", self.m["files"])
        for k in ("files", "extra"):
            self.assertNotIn("/roms/ports/x.sh", self.m[k])

    def test_info_and_library_written(self):
        info = json.load(open(os.path.join(self.out, "info.json")))
        self.assertEqual((info["systems"], info["games"]), (1, 3))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "library.json.gz")))

    def test_read_lsjson_skips_dirs(self):
        d = mkmanifest.read_lsjson(self.lsj)
        self.assertNotIn("snes", d)
        self.assertIn("snes/Jogo.7z", d)

if __name__ == "__main__":
    unittest.main()
