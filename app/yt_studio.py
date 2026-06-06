#!/usr/bin/env python3
"""
YT Longform Studio - Aplikasi kontrol lokal (modern UI / CustomTkinter).

Fitur:
- Dashboard ringkasan + monitor video dari state hosting.
- Buat video di lokal (menjalankan pipeline Node) dengan log streaming.
- Trigger GitHub Action (cloud render) langsung dari aplikasi.
- Editor lengkap API key & kredensial (.env) dengan tampilan rapi.
- Pengaturan aplikasi disimpan di app/config.json.

Jalankan: python yt_studio.py  (atau klik run-app.bat)
"""

import json
import os
import queue
import subprocess
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
CONFIG_PATH = APP_DIR / "config.json"
ENV_PATH = PROJECT_DIR / ".env"

# ---------------- Theme ----------------
COLORS = {
    "bg": "#0a0e14",
    "bg2": "#0f141d",
    "panel": "#131925",
    "panel2": "#1a2230",
    "border": "#232c3d",
    "text": "#e7eef7",
    "muted": "#8693a8",
    "accent": "#f5c84c",
    "accent_hover": "#e0a83a",
    "blue": "#58a6ff",
    "ok": "#2ea043",
    "err": "#f85149",
    "warn": "#d29922",
}

FONT = "Segoe UI"

DEFAULT_CONFIG = {
    "stateUrl": "https://yt.emsa.pro/state/items.json",
    "mediaBaseUrl": "https://yt.emsa.pro",
    "github": {
        "repo": "emsabiq/yt-longform",
        "workflow": "yt-longform-generate.yml",
        "ref": "main",
        "token": "",
    },
    "local": {"nodeCommand": "npm", "projectDir": str(PROJECT_DIR)},
}

# Definisi field .env yang bisa diedit lewat aplikasi.
ENV_SECTIONS = [
    ("OpenAI", [
        ("OPENAI_API_KEY", "API Key", True),
        ("OPENAI_BASE_URL", "Base URL", False),
        ("STORY_MODEL", "Story Model", False),
        ("IMAGE_MODEL", "Image Model", False),
        ("IMAGE_SIZE", "Image Size", False),
        ("IMAGE_QUALITY", "Image Quality", False),
        ("OPENAI_TTS_MODEL", "TTS Model", False),
        ("OPENAI_TTS_VOICE", "TTS Voice", False),
        ("OPENAI_TRANSCRIBE_MODEL", "Transcribe Model", False),
    ]),
    ("ElevenLabs (opsional)", [
        ("ELEVENLABS_API_KEY", "API Key", True),
        ("ELEVENLABS_MODEL", "Model", False),
        ("ELEVENLABS_VOICE_ID", "Voice ID", False),
    ]),
    ("YouTube Upload", [
        ("YOUTUBE_UPLOAD_ENABLED", "Aktif (true/false)", False),
        ("YOUTUBE_CLIENT_ID", "Client ID", True),
        ("YOUTUBE_CLIENT_SECRET", "Client Secret", True),
        ("YOUTUBE_REFRESH_TOKEN", "Refresh Token", True),
        ("YOUTUBE_PRIVACY_STATUS", "Privacy (public/unlisted/private)", False),
        ("YOUTUBE_CATEGORY_ID", "Category ID", False),
        ("YOUTUBE_DAILY_UPLOAD_LIMIT", "Batas upload/hari", False),
    ]),
    ("Hosting / SFTP", [
        ("PUBLIC_BASE_URL", "Public Base URL", False),
        ("UPLOAD_DRIVER", "Driver (sftp/ftp)", False),
        ("SFTP_HOST", "SFTP Host", False),
        ("SFTP_PORT", "SFTP Port", False),
        ("SFTP_USER", "SFTP User", False),
        ("SFTP_PASSWORD", "SFTP Password", True),
        ("SFTP_REMOTE_DIR", "Remote Dir", False),
    ]),
    ("Otomatisasi", [
        ("AUTO_DASHBOARD_PIN", "Dashboard PIN", True),
        ("YT_DURATION_SEC", "Durasi default (detik)", False),
        ("YT_SCENE_COUNT", "Scene default", False),
        ("YT_DAILY_GENERATE_LIMIT", "Batas generate/hari", False),
        ("YT_TIME_ZONE", "Time Zone", False),
    ]),
]


# ---------------- Helpers ----------------
def deep_update(base, extra):
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_update(base[key], value)
        else:
            base[key] = value
    return base


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG_PATH.exists():
        try:
            deep_update(cfg, json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as exc:  # noqa: BLE001
            print(f"config.json gagal dibaca: {exc}")
    return cfg


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def parse_env():
    data = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            data[key.strip()] = value.strip()
    return data


def write_env(updates):
    """Update .env mempertahankan baris lain & komentar."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    seen = set()
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")


def fmt_date(value):
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone().strftime("%d %b %Y %H:%M")
    except Exception:  # noqa: BLE001
        return str(value)


def fmt_dur(seconds):
    try:
        seconds = float(seconds)
    except (TypeError, ValueError):
        return "-"
    if not seconds:
        return "-"
    return f"{int(seconds // 60)}m {int(seconds % 60)}s"


# ---------------- Reusable widgets ----------------
class Card(ctk.CTkFrame):
    def __init__(self, master, **kwargs):
        super().__init__(master, fg_color=COLORS["panel"], corner_radius=14,
                         border_width=1, border_color=COLORS["border"], **kwargs)


class StatCard(ctk.CTkFrame):
    def __init__(self, master, label, value="0"):
        super().__init__(master, fg_color=COLORS["panel"], corner_radius=14,
                         border_width=1, border_color=COLORS["border"])
        self.value_lbl = ctk.CTkLabel(self, text=value, font=(FONT, 26, "bold"),
                                      text_color=COLORS["accent"])
        self.value_lbl.pack(anchor="w", padx=16, pady=(14, 0))
        ctk.CTkLabel(self, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(
            anchor="w", padx=16, pady=(0, 14))

    def set(self, value):
        self.value_lbl.configure(text=str(value))


def section_title(master, text):
    return ctk.CTkLabel(master, text=text, font=(FONT, 16, "bold"), text_color=COLORS["text"])


# ---------------- Main App ----------------
class YTStudioApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.cfg = load_config()
        self.items = []
        self.log_queue = queue.Queue()
        self.env_vars = {}
        self.stat_cards = {}

        self.title("YT Longform Studio")
        self.geometry("1180x760")
        self.minsize(960, 640)
        self.configure(fg_color=COLORS["bg"])

        ctk.set_appearance_mode("dark")

        self._build_layout()
        self.show_view("dashboard")
        self.after(300, self.refresh_state)
        self.after(120, self._drain_log)
        self._tick_clock()

    # ---------- Layout ----------
    def _build_layout(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)
        self._build_sidebar()
        self._build_main()

    def _build_sidebar(self):
        bar = ctk.CTkFrame(self, width=210, fg_color=COLORS["bg2"], corner_radius=0)
        bar.grid(row=0, column=0, sticky="nsw")
        bar.grid_propagate(False)

        brand = ctk.CTkFrame(bar, fg_color="transparent")
        brand.pack(fill="x", padx=18, pady=(22, 24))
        ctk.CTkLabel(brand, text="\u25B6", font=(FONT, 22, "bold"),
                     text_color=COLORS["accent"]).pack(side="left")
        ctk.CTkLabel(brand, text="  YT Longform", font=(FONT, 17, "bold"),
                     text_color=COLORS["text"]).pack(side="left")

        self.nav_buttons = {}
        nav = [
            ("dashboard", "\U0001F4CA  Ringkasan"),
            ("create", "\u2728  Buat Video"),
            ("library", "\U0001F3AC  Pustaka"),
            ("settings", "\U0001F511  API & Kredensial"),
            ("app_settings", "\u2699  Pengaturan App"),
        ]
        for key, label in nav:
            btn = ctk.CTkButton(
                bar, text=label, anchor="w", height=42, corner_radius=10,
                fg_color="transparent", hover_color=COLORS["panel"],
                text_color=COLORS["muted"], font=(FONT, 14),
                command=lambda k=key: self.show_view(k))
            btn.pack(fill="x", padx=12, pady=3)
            self.nav_buttons[key] = btn

        foot = ctk.CTkFrame(bar, fg_color="transparent")
        foot.pack(side="bottom", fill="x", padx=12, pady=16)
        ctk.CTkButton(foot, text="\u27F3  Refresh", height=34, corner_radius=9,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=self.refresh_state).pack(fill="x", pady=3)
        self.clock_lbl = ctk.CTkLabel(foot, text="--:--", font=(FONT, 12),
                                      text_color=COLORS["muted"])
        self.clock_lbl.pack(pady=(8, 0))

    def _build_main(self):
        wrap = ctk.CTkFrame(self, fg_color="transparent")
        wrap.grid(row=0, column=1, sticky="nsew")
        wrap.grid_columnconfigure(0, weight=1)
        wrap.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(wrap, fg_color="transparent", height=64)
        header.grid(row=0, column=0, sticky="ew", padx=26, pady=(20, 6))
        self.view_kicker = ctk.CTkLabel(header, text="RINGKASAN", font=(FONT, 11, "bold"),
                                        text_color=COLORS["accent"])
        self.view_kicker.pack(anchor="w")
        self.view_title = ctk.CTkLabel(header, text="Operational Overview",
                                       font=(FONT, 22, "bold"), text_color=COLORS["text"])
        self.view_title.pack(anchor="w")
        self.status_lbl = ctk.CTkLabel(header, text="", font=(FONT, 12),
                                       text_color=COLORS["muted"])
        self.status_lbl.place(relx=1.0, rely=0.4, anchor="e")

        self.container = ctk.CTkFrame(wrap, fg_color="transparent")
        self.container.grid(row=1, column=0, sticky="nsew", padx=26, pady=(4, 20))
        self.container.grid_columnconfigure(0, weight=1)
        self.container.grid_rowconfigure(0, weight=1)

        self.views = {}
        self.views["dashboard"] = self._build_dashboard_view()
        self.views["create"] = self._build_create_view()
        self.views["library"] = self._build_library_view()
        self.views["settings"] = self._build_settings_view()
        self.views["app_settings"] = self._build_app_settings_view()

    VIEW_META = {
        "dashboard": ("RINGKASAN", "Operational Overview"),
        "create": ("BUAT VIDEO", "Generator Video Panjang"),
        "library": ("PUSTAKA", "Semua Video"),
        "settings": ("API & KREDENSIAL", "Editor Environment"),
        "app_settings": ("PENGATURAN APP", "Koneksi & GitHub"),
    }

    def show_view(self, key):
        for view in self.views.values():
            view.grid_forget()
        self.views[key].grid(row=0, column=0, sticky="nsew")
        for k, btn in self.nav_buttons.items():
            active = k == key
            btn.configure(fg_color=COLORS["panel2"] if active else "transparent",
                          text_color=COLORS["accent"] if active else COLORS["muted"])
        kicker, title = self.VIEW_META.get(key, ("", ""))
        self.view_kicker.configure(text=kicker)
        self.view_title.configure(text=title)
        if key == "settings":
            self._load_env_into_form()

    # ---------- Dashboard view ----------
    def _build_dashboard_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        stats = ctk.CTkFrame(view, fg_color="transparent")
        stats.pack(fill="x", pady=(0, 16))
        for i in range(4):
            stats.grid_columnconfigure(i, weight=1)
        labels = [("total", "Total Video"), ("uploaded", "Terupload"),
                  ("rendered", "Rendered"), ("today", "Hari Ini")]
        for i, (key, label) in enumerate(labels):
            card = StatCard(stats, label)
            card.grid(row=0, column=i, sticky="ew", padx=(0 if i == 0 else 10, 0))
            self.stat_cards[key] = card

        # Recent videos
        recent_card = Card(view)
        recent_card.pack(fill="both", expand=True)
        head = ctk.CTkFrame(recent_card, fg_color="transparent")
        head.pack(fill="x", padx=18, pady=(16, 8))
        section_title(head, "Video Terakhir").pack(side="left")
        ctk.CTkButton(head, text="Lihat semua", width=100, height=30, corner_radius=8,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=lambda: self.show_view("library")).pack(side="right")
        self.recent_frame = ctk.CTkFrame(recent_card, fg_color="transparent")
        self.recent_frame.pack(fill="both", expand=True, padx=18, pady=(0, 16))
        return view

    # ---------- Create view ----------
    def _build_create_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        form_card = Card(view)
        form_card.pack(fill="x", pady=(0, 16))
        section_title(form_card, "  Parameter Video").pack(anchor="w", padx=18, pady=(16, 10))

        body = ctk.CTkFrame(form_card, fg_color="transparent")
        body.pack(fill="x", padx=18, pady=(0, 16))
        body.grid_columnconfigure((0, 1, 2), weight=1)

        self.f_topic = self._labeled_entry(body, "Topik (kosong = AI memilih)", 0, 0, span=3,
                                            placeholder="cth: Kenapa kapal baja bisa mengapung")
        self.f_category = self._labeled_combo(body, "Kategori", 1, 0,
                                              ["random", "sains", "sejarah", "teknologi", "misteri", "bisnis"])
        self.f_duration = self._labeled_combo(body, "Durasi (detik)", 1, 1,
                                              ["300", "360", "480", "600", "720"], default="360")
        self.f_scenes = self._labeled_combo(body, "Jumlah scene", 1, 2,
                                            ["10", "12", "14", "16", "18"], default="14")
        self.f_tts = self._labeled_combo(body, "TTS provider", 2, 0, ["openai", "elevenlabs"])
        self.f_voice = self._labeled_combo(body, "TTS voice", 2, 1,
                                          ["cedar", "ash", "ballad", "shimmer", "verse"])
        self.f_quality = self._labeled_combo(body, "Kualitas gambar", 2, 2,
                                            ["low", "medium", "high"])

        self.f_force = ctk.CTkCheckBox(body, text="Paksa (abaikan batas harian)",
                                       fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"])
        self.f_force.select()
        self.f_force.grid(row=3, column=0, columnspan=3, sticky="w", pady=(12, 0))

        actions = ctk.CTkFrame(view, fg_color="transparent")
        actions.pack(fill="x", pady=(0, 16))
        self.btn_local = ctk.CTkButton(actions, text="\u25B6  Jalankan Lokal (Node)", height=44,
                                       corner_radius=10, fg_color=COLORS["accent"],
                                       hover_color=COLORS["accent_hover"], text_color="#1a1407",
                                       font=(FONT, 14, "bold"), command=self.run_local)
        self.btn_local.pack(side="left", padx=(0, 10))
        self.btn_cloud = ctk.CTkButton(actions, text="\u2601  Trigger GitHub Action", height=44,
                                       corner_radius=10, fg_color=COLORS["panel2"],
                                       hover_color=COLORS["border"], font=(FONT, 14),
                                       command=self.trigger_github)
        self.btn_cloud.pack(side="left")
        ctk.CTkButton(actions, text="Bersihkan Log", height=44, corner_radius=10,
                      fg_color="transparent", hover_color=COLORS["panel"],
                      command=lambda: self.console.delete("1.0", "end")).pack(side="right")

        # Console
        console_card = Card(view)
        console_card.pack(fill="both", expand=True)
        section_title(console_card, "  Konsol Proses").pack(anchor="w", padx=18, pady=(16, 8))
        self.console = ctk.CTkTextbox(console_card, fg_color="#060a10", corner_radius=10,
                                      font=("Consolas", 12), text_color="#c8d3e0", height=240)
        self.console.pack(fill="both", expand=True, padx=18, pady=(0, 16))
        self.console.insert("end", "Siap. Pilih parameter lalu jalankan.\n")
        return view

    def _labeled_entry(self, master, label, r, c, span=1, placeholder=""):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, columnspan=span, sticky="ew", padx=(0, 12), pady=6)
        ctk.CTkLabel(wrap, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(anchor="w")
        entry = ctk.CTkEntry(wrap, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                             border_color=COLORS["border"], placeholder_text=placeholder)
        entry.pack(fill="x", pady=(4, 0))
        return entry

    def _labeled_combo(self, master, label, r, c, values, default=None):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, sticky="ew", padx=(0, 12), pady=6)
        ctk.CTkLabel(wrap, text=label, font=(FONT, 12), text_color=COLORS["muted"]).pack(anchor="w")
        combo = ctk.CTkComboBox(wrap, values=values, height=38, corner_radius=9,
                                fg_color=COLORS["bg2"], border_color=COLORS["border"],
                                button_color=COLORS["panel2"], button_hover_color=COLORS["border"])
        combo.set(default or values[0])
        combo.pack(fill="x", pady=(4, 0))
        return combo

    # ---------- Library view ----------
    def _build_library_view(self):
        view = ctk.CTkFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)
        view.grid_rowconfigure(1, weight=1)

        tools = ctk.CTkFrame(view, fg_color="transparent")
        tools.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.lib_search = ctk.CTkEntry(tools, placeholder_text="Cari judul / topik...",
                                       height=38, width=320, corner_radius=9,
                                       fg_color=COLORS["bg2"], border_color=COLORS["border"])
        self.lib_search.pack(side="left")
        self.lib_search.bind("<KeyRelease>", lambda _e: self._render_library())
        self.lib_filter = ctk.CTkComboBox(tools, values=["Semua", "Terupload", "Rendered", "Gagal"],
                                          height=38, width=160, corner_radius=9,
                                          fg_color=COLORS["bg2"], border_color=COLORS["border"],
                                          button_color=COLORS["panel2"],
                                          command=lambda _v: self._render_library())
        self.lib_filter.set("Semua")
        self.lib_filter.pack(side="left", padx=10)

        self.library_frame = ctk.CTkScrollableFrame(view, fg_color="transparent")
        self.library_frame.grid(row=1, column=0, sticky="nsew")
        self.library_frame.grid_columnconfigure((0, 1, 2), weight=1)
        return view

    # ---------- Settings (env) view ----------
    def _build_settings_view(self):
        view = ctk.CTkFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)
        view.grid_rowconfigure(0, weight=1)

        scroll = ctk.CTkScrollableFrame(view, fg_color="transparent")
        scroll.grid(row=0, column=0, sticky="nsew")
        scroll.grid_columnconfigure(0, weight=1)

        info = Card(scroll)
        info.pack(fill="x", pady=(0, 14))
        ctk.CTkLabel(info, text="Semua nilai disimpan ke file .env proyek. Field sensitif disamarkan; "
                     "klik \U0001F441 untuk menampilkan.", font=(FONT, 12),
                     text_color=COLORS["muted"], wraplength=820, justify="left").pack(
            anchor="w", padx=18, pady=14)

        for sec_title, fields in ENV_SECTIONS:
            card = Card(scroll)
            card.pack(fill="x", pady=(0, 12))
            section_title(card, "  " + sec_title).pack(anchor="w", padx=18, pady=(14, 8))
            grid = ctk.CTkFrame(card, fg_color="transparent")
            grid.pack(fill="x", padx=18, pady=(0, 14))
            grid.grid_columnconfigure((0, 1), weight=1)
            for idx, (env_key, label, secret) in enumerate(fields):
                self._env_field(grid, env_key, label, secret, idx // 2, idx % 2)

        bar = ctk.CTkFrame(view, fg_color="transparent")
        bar.grid(row=1, column=0, sticky="ew", pady=(12, 0))
        ctk.CTkButton(bar, text="\U0001F4BE  Simpan ke .env", height=44, corner_radius=10,
                      fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
                      text_color="#1a1407", font=(FONT, 14, "bold"),
                      command=self.save_env).pack(side="left")
        ctk.CTkButton(bar, text="Muat ulang", height=44, corner_radius=10,
                      fg_color=COLORS["panel2"], hover_color=COLORS["border"],
                      command=self._load_env_into_form).pack(side="left", padx=10)
        ctk.CTkButton(bar, text="Tes Preflight", height=44, corner_radius=10,
                      fg_color="transparent", hover_color=COLORS["panel"],
                      command=self.run_preflight).pack(side="right")
        return view

    def _env_field(self, master, env_key, label, secret, r, c):
        wrap = ctk.CTkFrame(master, fg_color="transparent")
        wrap.grid(row=r, column=c, sticky="ew", padx=(0, 14), pady=6)
        wrap.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(wrap, text=f"{label}  ({env_key})", font=(FONT, 11),
                     text_color=COLORS["muted"]).grid(row=0, column=0, columnspan=2, sticky="w")
        entry = ctk.CTkEntry(wrap, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                             border_color=COLORS["border"], show="\u2022" if secret else "")
        entry.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        if secret:
            toggle = ctk.CTkButton(wrap, text="\U0001F441", width=40, height=38, corner_radius=9,
                                   fg_color=COLORS["panel2"], hover_color=COLORS["border"])
            toggle.grid(row=1, column=1, padx=(6, 0), pady=(4, 0))
            toggle.configure(command=lambda e=entry: e.configure(
                show="" if e.cget("show") else "\u2022"))
        self.env_vars[env_key] = entry

    def _load_env_into_form(self):
        data = parse_env()
        for key, entry in self.env_vars.items():
            entry.delete(0, "end")
            entry.insert(0, data.get(key, ""))

    def save_env(self):
        updates = {}
        for key, entry in self.env_vars.items():
            value = entry.get().strip()
            if value:
                updates[key] = value
        if not updates:
            messagebox.showwarning("Kosong", "Tidak ada nilai untuk disimpan.")
            return
        try:
            write_env(updates)
            messagebox.showinfo("Tersimpan", f"{len(updates)} nilai disimpan ke .env")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Gagal", str(exc))

    # ---------- App settings view ----------
    def _build_app_settings_view(self):
        view = ctk.CTkScrollableFrame(self.container, fg_color="transparent")
        view.grid_columnconfigure(0, weight=1)

        card = Card(view)
        card.pack(fill="x", pady=(0, 14))
        section_title(card, "  Koneksi Dashboard & GitHub").pack(anchor="w", padx=18, pady=(14, 8))
        body = ctk.CTkFrame(card, fg_color="transparent")
        body.pack(fill="x", padx=18, pady=(0, 14))
        body.grid_columnconfigure(0, weight=1)

        self.app_fields = {}
        rows = [
            ("stateUrl", "State URL (monitoring)", self.cfg["stateUrl"], False),
            ("repo", "GitHub repo (owner/name)", self.cfg["github"]["repo"], False),
            ("workflow", "Workflow file", self.cfg["github"]["workflow"], False),
            ("ref", "Branch / ref", self.cfg["github"]["ref"], False),
            ("token", "GitHub token (untuk trigger)", self.cfg["github"]["token"], True),
            ("projectDir", "Folder proyek Node", self.cfg["local"]["projectDir"], False),
        ]
        for i, (key, label, value, secret) in enumerate(rows):
            ctk.CTkLabel(body, text=label, font=(FONT, 12), text_color=COLORS["muted"]).grid(
                row=i * 2, column=0, sticky="w", pady=(8, 2))
            entry = ctk.CTkEntry(body, height=38, corner_radius=9, fg_color=COLORS["bg2"],
                                 border_color=COLORS["border"], show="\u2022" if secret else "")
            entry.insert(0, value)
            entry.grid(row=i * 2 + 1, column=0, sticky="ew")
            self.app_fields[key] = entry

        ctk.CTkButton(view, text="\U0001F4BE  Simpan Pengaturan", height=44, corner_radius=10,
                      fg_color=COLORS["accent"], hover_color=COLORS["accent_hover"],
                      text_color="#1a1407", font=(FONT, 14, "bold"),
                      command=self.save_app_settings).pack(anchor="w")

        note = Card(view)
        note.pack(fill="x", pady=(14, 0))
        ctk.CTkLabel(note, text="Token GitHub hanya dipakai untuk men-trigger workflow dari aplikasi. "
                     "Disimpan lokal di app/config.json dan tidak diunggah ke mana pun.",
                     font=(FONT, 12), text_color=COLORS["muted"], wraplength=820,
                     justify="left").pack(anchor="w", padx=18, pady=14)
        return view

    def save_app_settings(self):
        self.cfg["stateUrl"] = self.app_fields["stateUrl"].get().strip()
        self.cfg["github"]["repo"] = self.app_fields["repo"].get().strip()
        self.cfg["github"]["workflow"] = self.app_fields["workflow"].get().strip()
        self.cfg["github"]["ref"] = self.app_fields["ref"].get().strip()
        self.cfg["github"]["token"] = self.app_fields["token"].get().strip()
        self.cfg["local"]["projectDir"] = self.app_fields["projectDir"].get().strip()
        try:
            save_config(self.cfg)
            messagebox.showinfo("Tersimpan", "Pengaturan aplikasi disimpan.")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Gagal", str(exc))

    # ---------- Data ----------
    def refresh_state(self):
        url = self.cfg.get("stateUrl", "")
        self.status_lbl.configure(text="Memuat data...")
        threading.Thread(target=self._fetch_state, args=(url,), daemon=True).start()

    def _fetch_state(self, url):
        if not url or requests is None:
            self.after(0, lambda: self.status_lbl.configure(text="State URL belum diatur"))
            return
        try:
            resp = requests.get(f"{url}?v={int(datetime.now(timezone.utc).timestamp())}",
                                headers={"Cache-Control": "no-store"}, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            items = data if isinstance(data, list) else data.get("items", [])
            items.sort(key=lambda it: str(it.get("updatedAt") or it.get("createdAt") or ""), reverse=True)
            self.items = items
            self.after(0, self._render_all)
        except Exception as exc:  # noqa: BLE001
            self.after(0, lambda: self.status_lbl.configure(text=f"Gagal: {exc}"))

    def _render_all(self):
        self._render_stats()
        self._render_recent()
        self._render_library()
        self.status_lbl.configure(
            text=f"{len(self.items)} video \u00B7 {datetime.now().strftime('%H:%M:%S')}")

    def _status_of(self, it):
        if (it.get("publish") or {}).get("youtube", {}).get("url"):
            return "uploaded", "Terupload", COLORS["ok"]
        if it.get("status") == "rendered" or (it.get("assets") or {}).get("video"):
            return "rendered", "Rendered", COLORS["accent"]
        if (it.get("publish") or {}).get("errors", {}).get("youtube"):
            return "failed", "Gagal", COLORS["err"]
        return "draft", "Draft", COLORS["muted"]

    def _render_stats(self):
        today = datetime.now().strftime("%Y-%m-%d")
        uploaded = sum(1 for it in self.items if self._status_of(it)[0] == "uploaded")
        rendered = sum(1 for it in self.items if self._status_of(it)[0] in ("rendered", "uploaded"))
        today_count = sum(1 for it in self.items if str(it.get("createdAt", ""))[:10] == today)
        self.stat_cards["total"].set(len(self.items))
        self.stat_cards["uploaded"].set(uploaded)
        self.stat_cards["rendered"].set(rendered)
        self.stat_cards["today"].set(today_count)

    def _render_recent(self):
        for w in self.recent_frame.winfo_children():
            w.destroy()
        items = self.items[:6]
        if not items:
            ctk.CTkLabel(self.recent_frame, text="Belum ada video.",
                         text_color=COLORS["muted"]).pack(anchor="w")
            return
        for i in range(3):
            self.recent_frame.grid_columnconfigure(i, weight=1)
        for idx, it in enumerate(items):
            self._video_card(self.recent_frame, it, idx // 3, idx % 3)

    def _render_library(self):
        for w in self.library_frame.winfo_children():
            w.destroy()
        q = self.lib_search.get().lower().strip()
        flt = self.lib_filter.get()
        flt_map = {"Terupload": "uploaded", "Rendered": "rendered", "Gagal": "failed"}
        items = self.items
        if q:
            items = [it for it in items if q in f"{it.get('title','')} {it.get('input',{}).get('topic','')}".lower()]
        if flt in flt_map:
            items = [it for it in items if self._status_of(it)[0] == flt_map[flt]]
        if not items:
            ctk.CTkLabel(self.library_frame, text="Tidak ada video.",
                         text_color=COLORS["muted"]).grid(row=0, column=0, pady=30)
            return
        for idx, it in enumerate(items):
            self._video_card(self.library_frame, it, idx // 3, idx % 3)

    def _video_card(self, master, it, r, c):
        card = ctk.CTkFrame(master, fg_color=COLORS["panel2"], corner_radius=12,
                            border_width=1, border_color=COLORS["border"])
        card.grid(row=r, column=c, sticky="nsew", padx=8, pady=8)
        _key, status_text, status_color = self._status_of(it)
        title = it.get("title") or "(tanpa judul)"
        ctk.CTkLabel(card, text=status_text, font=(FONT, 11, "bold"), text_color=status_color).pack(
            anchor="w", padx=14, pady=(12, 2))
        ctk.CTkLabel(card, text=title, font=(FONT, 14, "bold"), text_color=COLORS["text"],
                     wraplength=240, justify="left").pack(anchor="w", padx=14)
        meta = f"{it.get('input', {}).get('category', '')} \u00B7 {fmt_date(it.get('createdAt'))}"
        ctk.CTkLabel(card, text=meta, font=(FONT, 11), text_color=COLORS["muted"]).pack(
            anchor="w", padx=14, pady=(2, 0))
        dur = (it.get("assets") or {}).get("video", {}).get("durationSec")
        ctk.CTkLabel(card, text=f"Durasi: {fmt_dur(dur)}", font=(FONT, 11),
                     text_color=COLORS["muted"]).pack(anchor="w", padx=14)
        yt = (it.get("publish") or {}).get("youtube", {}).get("url")
        btn = ctk.CTkButton(card, text="\u25B6 Buka YouTube" if yt else "Belum diupload",
                            height=32, corner_radius=8,
                            fg_color=COLORS["accent"] if yt else COLORS["panel"],
                            hover_color=COLORS["accent_hover"] if yt else COLORS["panel"],
                            text_color="#1a1407" if yt else COLORS["muted"],
                            state="normal" if yt else "disabled",
                            command=lambda u=yt: webbrowser.open(u) if u else None)
        btn.pack(fill="x", padx=14, pady=12)

    # ---------- Actions ----------
    def _params(self):
        return {
            "topic": self.f_topic.get().strip(),
            "category": self.f_category.get(),
            "durationSec": self.f_duration.get(),
            "sceneCount": self.f_scenes.get(),
            "ttsProvider": self.f_tts.get(),
            "ttsVoice": self.f_voice.get(),
            "imageQuality": self.f_quality.get(),
            "force": "true" if self.f_force.get() else "false",
        }

    def _log(self, msg):
        self.log_queue.put(msg)

    def _drain_log(self):
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.console.insert("end", msg + "\n")
                self.console.see("end")
        except queue.Empty:
            pass
        self.after(120, self._drain_log)

    def run_local(self):
        p = self._params()
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        cmd = [node_cmd, "run", "run:once", "--",
               "--topic", p["topic"], "--category", p["category"],
               "--duration", p["durationSec"], "--scenes", p["sceneCount"],
               "--tts-provider", p["ttsProvider"], "--tts-voice", p["ttsVoice"],
               "--image-quality", p["imageQuality"], "--force", p["force"]]
        self.show_view("create")
        self._log(f"$ {' '.join(cmd)}")
        self.btn_local.configure(state="disabled", text="Sedang berjalan...")
        threading.Thread(target=self._run_subprocess, args=(cmd, project_dir), daemon=True).start()

    def _run_subprocess(self, cmd, cwd):
        try:
            proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, bufsize=1,
                                    shell=(os.name == "nt"))
            for line in proc.stdout:
                self._log(line.rstrip())
            proc.wait()
            self._log(f"--- selesai (exit {proc.returncode}) ---")
        except FileNotFoundError:
            self._log("ERROR: node/npm tidak ditemukan. Cek PATH atau folder proyek.")
        except Exception as exc:  # noqa: BLE001
            self._log(f"ERROR: {exc}")
        finally:
            self.after(0, lambda: self.btn_local.configure(
                state="normal", text="\u25B6  Jalankan Lokal (Node)"))
            self.after(1500, self.refresh_state)

    def trigger_github(self):
        token = self.cfg["github"].get("token", "").strip()
        if not token:
            messagebox.showwarning("Token kosong", "Isi GitHub token di 'Pengaturan App' dulu.")
            self.show_view("app_settings")
            return
        if requests is None:
            messagebox.showerror("Tidak bisa", "Modul requests belum terpasang.")
            return
        p = self._params()
        repo = self.cfg["github"]["repo"]
        workflow = self.cfg["github"]["workflow"]
        url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
        payload = {"ref": self.cfg["github"].get("ref", "main"), "inputs": {
            "topic": p["topic"], "category": p["category"], "duration": p["durationSec"],
            "scenes": p["sceneCount"], "tts_provider": p["ttsProvider"],
            "tts_voice": p["ttsVoice"], "image_quality": p["imageQuality"], "force": p["force"]}}
        self.show_view("create")
        self._log(f"\u2601 Trigger {workflow} @ {repo}...")
        threading.Thread(target=self._post_github, args=(url, token, payload), daemon=True).start()

    def _post_github(self, url, token, payload):
        try:
            resp = requests.post(url, json=payload, timeout=30, headers={
                "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"})
            if resp.status_code in (201, 204):
                self._log("\u2713 Workflow ter-trigger. Pantau di tab Actions GitHub.")
            else:
                self._log(f"Respon {resp.status_code}: {resp.text[:300]}")
        except Exception as exc:  # noqa: BLE001
            self._log(f"ERROR: {exc}")

    def run_preflight(self):
        project_dir = self.cfg["local"].get("projectDir") or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        self.show_view("create")
        self._log("$ npm run preflight")
        threading.Thread(target=self._run_subprocess,
                         args=([node_cmd, "run", "preflight"], project_dir), daemon=True).start()

    def _tick_clock(self):
        self.clock_lbl.configure(text=datetime.now().strftime("%H:%M:%S"))
        self.after(1000, self._tick_clock)


def main():
    app = YTStudioApp()
    app.mainloop()


if __name__ == "__main__":
    main()
