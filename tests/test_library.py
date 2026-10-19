# tests/test_library.py — library.json do seletor (data/mkmanifest.py build_library)
# python3 -m unittest tests.test_library
import gzip, json, os, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data"))
import mkmanifest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SYSTEMS = """<systemList>
<system><name>snes</name><fullname>Super Nintendo</fullname><path>/roms/snes/</path><extension>.sfc .7z</extension></system>
<system><name>psx</name><fullname>PlayStation</fullname><path>/roms/psx</path><extension>.cue .bin .m3u</extension></system>
<system><name>vazio</name><fullname>Sem jogos</fullname><path>/roms/vazio/</path><extension>.zip</extension></system>
<system><name>pico8</name><fullname>PICO-8</fullname><path>/roms/pico-8/carts</path><extension>.png</extension></system>
<system><name>ports</name><fullname>Ports</fullname><path>/roms/ports/</path><extension>.sh</extension></system>
</systemList>"""
GAMELIST = """<gameList>
<game><path>./Donkey Kong Country 3 (USA).sfc</path><name>Donkey Kong Country 3</name><desc>Dixie e Kiddy.</desc>
<releasedate>19961122T000000</releasedate><players>1-2</players><genre>Plataforma</genre>
<image>./images/DKC3-image.png</image><thumbnail>./images/DKC3-thumb.png</thumbnail><marquee>./images/DKC3-marquee.png</marquee></game>
<game><path>./Apagado.sfc</path><name>Não existe mais</name></game>
</gameList>"""
CORES = {"systems": {"snes": {"core": "snes9x", "fullname": "Super NES", "note": "", "order": 2},
                     "psx": {"core": "pcsx_rearmed", "fullname": "PlayStation", "note": "", "order": 1},
                     "pico-8": {"core": "retro8", "fullname": "PICO-8", "note": "", "order": 5},
                     "ports": {"core": None, "fullname": "Ports", "note": "sem núcleo libretro no dArkOS", "order": 9}}}

def touch(root, rel, data=b""):
    p = os.path.join(root, rel.lstrip("/"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data)

class Library(unittest.TestCase):
    def make(self, drive=False):
        src, out = tempfile.mkdtemp(), tempfile.mkdtemp()
        touch(src, "/etc/emulationstation/es_systems.cfg", SYSTEMS.encode())
        touch(src, "/roms/snes/gamelist.xml", GAMELIST.encode())
        touch(src, "/roms/snes/Donkey Kong Country 3 (USA).sfc", b"R" * 10)
        touch(src, "/roms/snes/Ação Total.7z", b"Z" * 5)
        touch(src, "/roms/snes/images/DKC3-image.png", b"PNG")
        touch(src, "/roms/snes/images/DKC3-thumb.png", b"PNG")
        touch(src, "/roms/psx/Disco (USA).cue", b'FILE "Disco (USA).bin" BINARY\n')
        touch(src, "/roms/psx/Disco (USA).bin", b"BIN")
        touch(src, "/roms/pico-8/carts/jogo.p8.png", b"P8")
        touch(src, "/roms/ports/Jogo.sh", b"#!/bin/sh")
        cores = os.path.join(out, "cores.json")
        json.dump(CORES, open(cores, "w"))
        ids = None
        if drive:
            ls = subprocess.check_output([sys.executable, "-I", os.path.join(ROOT, "tests", "mock_drive.py"), "--lsjson", os.path.join(src, "roms")])
            lsj = os.path.join(out, "ls.json"); open(lsj, "wb").write(ls)
            ids = mkmanifest.read_lsjson(lsj)
        mkmanifest.build(src, out, ids, cores)
        self.assertFalse(os.path.exists(os.path.join(out, "library.json")))   # só o .gz
        with gzip.open(os.path.join(out, "library.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f), ids

    def test_systems_in_cores_order_without_empty(self):
        lib, _ = self.make()
        self.assertEqual([s["id"] for s in lib["systems"]], ["psx", "snes", "pico-8", "ports"])
        snes = lib["systems"][1]
        self.assertEqual((snes["name"], snes["count"], snes["playable"]), ("Super Nintendo", 2, True))
        ports = lib["systems"][3]
        self.assertEqual((ports["playable"], ports["note"]), (False, "sem núcleo libretro no dArkOS"))

    def test_gamelist_metadata_and_fallback_name(self):
        lib, _ = self.make()
        games = {g["rom"]: g for g in lib["games"]}
        dk = games["/roms/snes/Donkey Kong Country 3 (USA).sfc"]
        self.assertEqual((dk["name"], dk["year"], dk["players"], dk["genre"], dk["desc"]),
                         ("Donkey Kong Country 3", 1996, "1-2", "Plataforma", "Dixie e Kiddy."))
        self.assertEqual(dk["box"], "/roms/snes/images/DKC3-thumb.png")
        self.assertEqual(dk["shot"], "/roms/snes/images/DKC3-image.png")
        self.assertNotIn("logo", dk)   # marquee citado mas o arquivo não existe
        self.assertEqual(dk["size"], 10)
        acao = games["/roms/snes/Ação Total.7z"]
        self.assertEqual(acao["name"], "Ação Total")
        self.assertNotIn("/roms/snes/Apagado.sfc", games)   # no gamelist, mas sem arquivo

    def test_system_id_is_folder_under_roms(self):
        lib, _ = self.make()
        pico = next(s for s in lib["systems"] if s["name"] == "PICO-8")
        self.assertEqual((pico["id"], pico["playable"]), ("pico-8", True))   # path é /roms/pico-8/carts
        g = next(g for g in lib["games"] if g["rom"].endswith("jogo.p8.png"))
        self.assertEqual(g["s"], "pico-8")

    def test_cue_hides_cited_bin(self):
        lib, _ = self.make()
        roms = [g["rom"] for g in lib["games"] if g["s"] == "psx"]
        self.assertEqual(roms, ["/roms/psx/Disco (USA).cue"])

    def test_drive_refs_are_ids(self):
        lib, ids = self.make(drive=True)
        dk = next(g for g in lib["games"] if g["name"] == "Donkey Kong Country 3")
        self.assertEqual(dk["box"], {"id": ids["snes/images/DKC3-thumb.png"]["id"], "v": ids["snes/images/DKC3-thumb.png"]["v"]})
        self.assertEqual(dk["id"], ids["snes/Donkey Kong Country 3 (USA).sfc"]["id"])

if __name__ == "__main__":
    unittest.main()
