# tests/test_drive_manifest.py — mkmanifest.py --drive-ids (índice da biblioteca no Google Drive)
# python3 -m unittest tests.test_drive_manifest
import json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SYSTEMS = """<systemList><system><name>snes</name><path>/roms/snes/</path><extension>.7z .cue</extension></system></systemList>"""

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
        touch(self.src, "/roms/snes/images/Jogo.png", b"PNG")
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/roms/themes/t/bg.jpg", b"JPG")
        # a pasta R36S do Drive = /roms; a listagem sai do mock (mesmo formato do rclone lsjson -R --hash)
        ls = subprocess.check_output([sys.executable, "-I", os.path.join(ROOT, "tests", "mock_drive.py"), "--lsjson", os.path.join(self.src, "roms")])
        self.ids = {e["Path"]: e["ID"] for e in json.loads(ls)}
        lsj = os.path.join(self.out, "ls.json")
        open(lsj, "wb").write(ls)
        self.lsj = lsj
        mkmanifest.build(self.src, self.out, mkmanifest.read_lsjson(lsj))
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.info = json.load(open(os.path.join(self.out, "info.json")))

    def test_roms_and_media_get_drive_ids(self):
        f = self.m["files"]
        self.assertEqual(f["/roms/snes/Jogo.7z"]["id"], self.ids["snes/Jogo.7z"])
        self.assertEqual(f["/roms/snes/images/Jogo.png"]["id"], self.ids["snes/images/Jogo.png"])
        self.assertEqual(f["/roms/themes/t/bg.jpg"]["id"], self.ids["themes/t/bg.jpg"])
        self.assertTrue(f["/roms/snes/Jogo.7z"]["v"])   # md5 -> versão do cache

    def test_outside_roms_is_eager(self):
        self.assertEqual(self.m["files"]["/usr/bin/emulationstation/resources/big.ttf"]["kind"], "eager")
        self.assertNotIn("id", self.m["files"]["/etc/emulationstation/es_systems.cfg"])

    def test_extra_has_tracks_and_card_saves_not_media(self):
        ex = self.m["extra"]
        self.assertEqual(ex["/roms/snes/Disco.bin"]["id"], self.ids["snes/Disco.bin"])
        self.assertIn("/roms/snes/Jogo.srm", ex)
        self.assertNotIn("/roms/snes/images/Jogo.png", ex)
        self.assertNotIn("/roms/snes/Jogo.7z", ex)

    def test_info_counts(self):
        self.assertEqual(self.info["systems"], 1)
        self.assertEqual(self.info["games"], 2)   # Jogo.7z + Disco.cue

    def test_read_lsjson_skips_dirs(self):
        d = mkmanifest.read_lsjson(self.lsj)
        self.assertNotIn("snes", d)
        self.assertIn("snes/Jogo.7z", d)

if __name__ == "__main__":
    unittest.main()
