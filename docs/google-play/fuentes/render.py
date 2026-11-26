"""Regenera el gráfico de funciones (es y en, 1024×500) y el icono (512×512) de Google Play.

Uso, desde la raíz del repositorio y con Chrome instalado: `python docs/google-play/fuentes/render.py`.
Necesita Pillow. Si cambian las capturas, se sustituyen antes `shot-calendar.png` (captura del
calendario en el móvil) y `shot-card.png` (recorte de una tarjeta).
"""
import pathlib
import subprocess
import tempfile

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def screenshot(page: str, size: tuple[int, int]) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        raw = pathlib.Path(tmp) / "raw.png"
        args = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={size[0]},{size[1]}",
            "--virtual-time-budget=3000",
            f"--user-data-dir={pathlib.Path(tmp) / 'perfil'}",
            f"--screenshot={raw}",
            # Las imágenes de la página son ficheros locales junto a ella.
            "--allow-file-access-from-files",
            page,
        ]
        subprocess.run(args, check=True, capture_output=True)
        image = Image.open(raw)
        image.load()
        return image


for lang in ("es", "en"):
    image = screenshot((HERE / "feature.html").as_uri() + f"?lang={lang}", (1024, 500))
    # Play no admite transparencia en el gráfico de funciones.
    image.convert("RGB").save(OUT / f"grafico-funciones-{lang}.png", optimize=True)
screenshot((HERE / "icon.html").as_uri(), (512, 512)).convert("RGBA").save(
    OUT / "icono-512.png", optimize=True)
print("listo")
