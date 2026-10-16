# tests/test_mkmanifest.py
import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class T(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.src, "/roms/themes/t/theme.xml", b"<theme/>")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg", b"<config/>")
        touch(self.src, "/roms/snes/gamelist.xml", b"<gameList/>")
        touch(self.src, "/etc/emulationstation/es_input.cfg", b"<inputList/>")
        touch(self.src, "/roms/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.src, "/roms/snes/images/Jogo (USA).png", b"PNG")
        touch(self.src, "/roms/themes/t/snes/fundo.jpg", b"JPGDATA")
        touch(self.src, "/roms/themes/t/bgm.mp3", b"MP3DATA")
        touch(self.src, "/usr/bin/emulationstation/resources/arrow.svg", b"<svg/>")
        touch(self.src, "/usr/bin/emulationstation/resources/big.ttf", b"F" * (2 * 1024 * 1024))
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_eager_files_are_in_blob(self):
        for path, data in [("/roms/themes/t/theme.xml", b"<theme/>"),
                           ("/home/ark/.emulationstation/es_settings.cfg", b"<config/>"),
                           ("/roms/snes/gamelist.xml", b"<gameList/>"),
                           ("/etc/emulationstation/es_input.cfg", b"<inputList/>")]:
            f = self.m["files"][path]
            self.assertEqual(f["kind"], "eager")
            self.assertEqual(self.blob[f["off"]:f["off"] + f["size"]], data)

    def test_rom_is_empty_and_not_in_blob(self):
        f = self.m["files"]["/roms/snes/Jogo (USA).7z"]
        self.assertEqual(f["kind"], "empty")
        self.assertNotIn(b"ROMDATA", self.blob)

    def test_image_is_lazy_with_url(self):
        f = self.m["files"]["/roms/snes/images/Jogo (USA).png"]
        self.assertEqual(f["kind"], "lazy")
        self.assertEqual(f["size"], 3)
        self.assertEqual(f["url"], "fs/roms/snes/images/Jogo%20%28USA%29.png")

    def test_theme_media_is_lazy(self):
        for path in ["/roms/themes/t/snes/fundo.jpg", "/roms/themes/t/bgm.mp3"]:
            self.assertEqual(self.m["files"][path]["kind"], "lazy")
        self.assertNotIn(b"JPGDATA", self.blob)

    def test_dirs_and_symlink(self):
        self.assertIn("/roms/snes/images", self.m["dirs"])
        self.assertEqual(self.m["symlinks"]["/etc/emulationstation/themes"], "/roms/themes")

    def test_es_resources_eager_except_big_fonts(self):
        self.assertEqual(self.m["files"]["/usr/bin/emulationstation/resources/arrow.svg"]["kind"], "eager")
        self.assertEqual(self.m["files"]["/usr/bin/emulationstation/resources/big.ttf"]["kind"], "lazy")

ES_SYSTEMS = b"""<?xml version="1.0"?>
<systemList>
  <system><name>snes</name><path>/roms/snes/</path><extension>.7z .7Z .sfc</extension></system>
  <system><name>pico-8</name><path>/roms/pico-8/carts</path><extension>.p8 .png</extension></system>
</systemList>
"""

class Card(unittest.TestCase):
    """Modo cartão real: es_systems.cfg presente -> só entra o que o ES usa; tema ativo eager; roms por symlink."""
    def setUp(self):
        self.card = tempfile.mkdtemp(); self.src = tempfile.mkdtemp(); self.out = tempfile.mkdtemp()
        touch(self.card, "/snes/Jogo (USA).7z", b"ROMDATA")
        touch(self.card, "/snes/Outro.sfc", b"ROM2")
        touch(self.card, "/snes/sub/Dentro.7z", b"ROM3")
        touch(self.card, "/snes/notas.txt", b"lixo")
        touch(self.card, "/snes/gamelist.xml", b"<gameList><game><path>./Jogo (USA).7z</path>"
              b"<image>./media/images/Jogo (USA).png</image><video>./media/videos/Jogo (USA).mp4</video></game></gameList>")
        touch(self.card, "/snes/media/images/Jogo (USA).png", b"PNG")
        touch(self.card, "/snes/media/images/Sem referencia.png", b"PNG")
        touch(self.card, "/snes/media/videos/Jogo (USA).mp4", b"MP4")
        touch(self.card, "/snes/images/Outro-image.png", b"LOCALART")
        touch(self.card, "/pico-8/carts/celeste.p8.png", b"P8")
        touch(self.card, "/pico-8/pico8.dat", b"BIN")
        touch(self.card, "/ports/Jogo.sh", b"#!/bin/sh")
        touch(self.card, "/BGM/musica.mp3", b"MP3")
        touch(self.card, "/bios/scph1001.bin", b"BIOS")
        touch(self.card, "/.Trash-1000/files/x.7z", b"LIXO")
        touch(self.card, "/snes/.oculto.7z", b"OCULTO")
        touch(self.card, "/themes/ativo/theme.xml", b"<theme/>")
        touch(self.card, "/themes/ativo/art/fundo.jpg", b"JPG")
        touch(self.card, "/themes/outro/theme.xml", b"<theme2/>")
        os.symlink(self.card, os.path.join(self.src, "roms"))
        touch(self.src, "/etc/emulationstation/es_systems.cfg", ES_SYSTEMS)
        touch(self.src, "/etc/emulationstation/es_input.cfg", b"<inputList/>")
        touch(self.src, "/home/ark/.emulationstation/es_settings.cfg",
              b'<?xml version="1.0"?>\n<string name="ThemeSet" value="ativo" />\n')
        os.makedirs(os.path.join(self.src, "home/ark/.emulationstation/collections"))
        mkmanifest.build(self.src, self.out)
        self.m = json.load(open(os.path.join(self.out, "manifest.json")))
        self.f = self.m["files"]
        self.blob = open(os.path.join(self.out, "eager.bin"), "rb").read()

    def test_roms_through_symlink_are_empty(self):
        for p in ["/roms/snes/Jogo (USA).7z", "/roms/snes/Outro.sfc", "/roms/snes/sub/Dentro.7z", "/roms/pico-8/carts/celeste.p8.png"]:
            self.assertEqual(self.f[p]["kind"], "empty", p)
        self.assertEqual(self.f["/roms/snes/Jogo (USA).7z"]["size"], 7)
        self.assertNotIn(b"ROMDATA", self.blob)

    def test_gamelist_eager_and_referenced_media_lazy(self):
        g = self.f["/roms/snes/gamelist.xml"]
        self.assertEqual(g["kind"], "eager")
        self.assertIn(b"<gameList>", self.blob[g["off"]:g["off"] + g["size"]])
        self.assertEqual(self.f["/roms/snes/media/images/Jogo (USA).png"]["kind"], "lazy")
        self.assertEqual(self.f["/roms/snes/media/videos/Jogo (USA).mp4"]["kind"], "lazy")
        self.assertEqual(self.f["/roms/snes/images/Outro-image.png"]["kind"], "lazy")   # LocalArt: images/

    def test_unused_files_left_out(self):
        for p in ["/roms/snes/notas.txt", "/roms/snes/media/images/Sem referencia.png", "/roms/pico-8/pico8.dat",
                  "/roms/ports/Jogo.sh", "/roms/BGM/musica.mp3", "/roms/.Trash-1000/files/x.7z", "/roms/snes/.oculto.7z"]:
            self.assertNotIn(p, self.f)
        self.assertFalse(any(d.startswith("/roms/.Trash") or d.startswith("/roms/BGM") for d in self.m["dirs"]))

    def test_bios_lazy(self):
        self.assertEqual(self.f["/roms/bios/scph1001.bin"]["kind"], "lazy")
        self.assertEqual(self.f["/roms/bios/scph1001.bin"]["url"], "fs/roms/bios/scph1001.bin")

    def test_only_active_theme_eager(self):
        self.assertEqual(self.f["/roms/themes/ativo/theme.xml"]["kind"], "eager")
        self.assertEqual(self.f["/roms/themes/ativo/art/fundo.jpg"]["kind"], "lazy")
        self.assertEqual(self.f["/roms/themes/outro/theme.xml"]["kind"], "lazy")

    def test_config_eager_and_empty_dirs_kept(self):
        self.assertEqual(self.f["/etc/emulationstation/es_systems.cfg"]["kind"], "eager")
        self.assertIn("/home/ark/.emulationstation/collections", self.m["dirs"])
        self.assertIn("/roms/snes/sub", self.m["dirs"])

if __name__ == "__main__":
    unittest.main()
