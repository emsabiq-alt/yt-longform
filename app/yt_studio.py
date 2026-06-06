#!/usr/bin/env python3
"""
YT Longform Studio - Aplikasi kontrol lokal (Tkinter).

Fungsi:
- Generate video panjang: jalankan pipeline Node lokal ATAU trigger GitHub Action.
- Monitor: tampilkan daftar video dari state JSON yang diupload ke hosting.

Konfigurasi diambil dari app/config.json (lihat config.example.json).
"""

import json
import os
import subprocess
import threading
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
CONFIG_PATH = APP_DIR / "config.json"
CONFIG_EXAMPLE = APP_DIR / "config.example.json"

DEFAULT_CONFIG = {
    "stateUrl": "https://yt.emsa.pro/state/items.json",
    "mediaBaseUrl": "https://yt.emsa.pro",
    "github": {
        "repo": "emsabiq/yt-longform",
        "workflow": "yt-longform-generate.yml",
        "ref": "main",
        "token": ""
    },
    "local": {
        "nodeCommand": "npm",
        "projectDir": str(PROJECT_DIR)
    }
}


def load_config():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            merged = json.loads(json.dumps(DEFAULT_CONFIG))
            _deep_update(merged, data)
            return merged
        except Exception as exc:  # noqa: BLE001
            print(f"Gagal baca config.json: {exc}")
    return json.loads(json.dumps(DEFAULT_CONFIG))


def _deep_update(base, extra):
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value
    return base


def fmt_date(value):
    if not value:
        return "-"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone().strftime("%d %b %Y %H:%M")
    except Exception:  # noqa: BLE001
        return str(value)


class YTStudioApp:
    def __init__(self, root):
        self.root = root
        self.cfg = load_config()
        self.items = []

        root.title("YT Longform Studio — Kontrol Lokal")
        root.geometry("980x680")
        root.minsize(820, 560)

        self._build_style()
        self._build_header()

        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self._build_generate_tab()
        self._build_monitor_tab()
        self._build_settings_tab()

        self.refresh_monitor()

    # ---------- UI scaffolding ----------
    def _build_style(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TNotebook", background="#0d1117")
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Treeview", rowheight=26, font=("Segoe UI", 9))
        style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))

    def _build_header(self):
        bar = tk.Frame(self.root, bg="#161b22", height=58)
        bar.pack(fill="x")
        bar.pack_propagate(False)
        tk.Label(bar, text="● YT Longform Studio", bg="#161b22", fg="#f5c84c",
                 font=("Segoe UI", 14, "bold")).pack(side="left", padx=16)
        tk.Label(bar, text="Khusus video panjang YouTube", bg="#161b22", fg="#8b97a7",
                 font=("Segoe UI", 9)).pack(side="left")

    # ---------- Generate tab ----------
    def _build_generate_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="  Generate  ")

        form = ttk.LabelFrame(tab, text="Parameter Video")
        form.pack(fill="x", padx=14, pady=12)

        self.var_topic = tk.StringVar()
        self.var_category = tk.StringVar(value="random")
        self.var_duration = tk.StringVar(value="360")
        self.var_scenes = tk.StringVar(value="14")
        self.var_tts = tk.StringVar(value="openai")
        self.var_voice = tk.StringVar(value="cedar")
        self.var_quality = tk.StringVar(value="low")
        self.var_force = tk.BooleanVar(value=True)

        rows = [
            ("Topik (kosong = AI pilih)", self.var_topic, None),
            ("Kategori", self.var_category, ["random", "sains", "sejarah", "teknologi", "misteri", "bisnis"]),
            ("Durasi (detik)", self.var_duration, ["300", "360", "480", "600", "720"]),
            ("Jumlah scene", self.var_scenes, ["10", "12", "14", "16", "18"]),
            ("TTS provider", self.var_tts, ["openai", "elevenlabs"]),
            ("TTS voice", self.var_voice, ["cedar", "ash", "ballad", "shimmer", "verse"]),
            ("Kualitas gambar", self.var_quality, ["low", "medium", "high"]),
        ]
        for i, (label, var, choices) in enumerate(rows):
            ttk.Label(form, text=label).grid(row=i, column=0, sticky="w", padx=10, pady=5)
            if choices:
                ttk.Combobox(form, textvariable=var, values=choices, width=42,
                             state="normal").grid(row=i, column=1, sticky="w", padx=10, pady=5)
            else:
                ttk.Entry(form, textvariable=var, width=44).grid(row=i, column=1, sticky="w", padx=10, pady=5)
        ttk.Checkbutton(form, text="Paksa (abaikan batas harian)", variable=self.var_force).grid(
            row=len(rows), column=1, sticky="w", padx=10, pady=5)

        btns = ttk.Frame(tab)
        btns.pack(fill="x", padx=14)
        ttk.Button(btns, text="▶ Jalankan Lokal (Node)", style="Accent.TButton",
                   command=self.run_local).pack(side="left", padx=(0, 8))
        ttk.Button(btns, text="☁ Trigger GitHub Action",
                   command=self.trigger_github).pack(side="left")
        ttk.Button(btns, text="Bersihkan Log", command=lambda: self.log_box.delete("1.0", "end")).pack(side="right")

        logframe = ttk.LabelFrame(tab, text="Log Proses")
        logframe.pack(fill="both", expand=True, padx=14, pady=12)
        self.log_box = scrolledtext.ScrolledText(logframe, bg="#0d1117", fg="#e6edf3",
                                                  font=("Cascadia Code", 9), insertbackground="#e6edf3")
        self.log_box.pack(fill="both", expand=True, padx=4, pady=4)

    # ---------- Monitor tab ----------
    def _build_monitor_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="  Monitor  ")

        top = ttk.Frame(tab)
        top.pack(fill="x", padx=14, pady=10)
        ttk.Button(top, text="⟳ Muat ulang", command=self.refresh_monitor).pack(side="left")
        self.monitor_status = ttk.Label(top, text="")
        self.monitor_status.pack(side="left", padx=12)

        cols = ("title", "status", "category", "duration", "created", "youtube")
        self.tree = ttk.Treeview(tab, columns=cols, show="headings", height=16)
        headers = {
            "title": ("Judul", 320),
            "status": ("Status", 90),
            "category": ("Kategori", 100),
            "duration": ("Durasi", 70),
            "created": ("Dibuat", 140),
            "youtube": ("YouTube", 110),
        }
        for key, (label, width) in headers.items():
            self.tree.heading(key, text=label)
            self.tree.column(key, width=width, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=14, pady=(0, 6))
        self.tree.bind("<Double-1>", self.open_selected_youtube)

        ttk.Label(tab, text="Klik dua kali baris untuk membuka video di YouTube.",
                  foreground="#8b97a7").pack(anchor="w", padx=14, pady=(0, 10))

    # ---------- Settings tab ----------
    def _build_settings_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="  Pengaturan  ")

        frame = ttk.LabelFrame(tab, text="Konfigurasi (app/config.json)")
        frame.pack(fill="x", padx=14, pady=12)

        self.var_state_url = tk.StringVar(value=self.cfg["stateUrl"])
        self.var_repo = tk.StringVar(value=self.cfg["github"]["repo"])
        self.var_workflow = tk.StringVar(value=self.cfg["github"]["workflow"])
        self.var_ref = tk.StringVar(value=self.cfg["github"]["ref"])
        self.var_token = tk.StringVar(value=self.cfg["github"]["token"])
        self.var_projdir = tk.StringVar(value=self.cfg["local"]["projectDir"])

        rows = [
            ("State URL (monitoring)", self.var_state_url),
            ("GitHub repo (owner/name)", self.var_repo),
            ("Workflow file", self.var_workflow),
            ("Branch / ref", self.var_ref),
            ("GitHub token (untuk trigger)", self.var_token),
            ("Folder proyek Node", self.var_projdir),
        ]
        for i, (label, var) in enumerate(rows):
            ttk.Label(frame, text=label).grid(row=i, column=0, sticky="w", padx=10, pady=6)
            show = "*" if "token" in label.lower() else ""
            ttk.Entry(frame, textvariable=var, width=60, show=show).grid(row=i, column=1, sticky="w", padx=10, pady=6)

        ttk.Button(tab, text="💾 Simpan Pengaturan", style="Accent.TButton",
                   command=self.save_settings).pack(anchor="w", padx=14)
        ttk.Label(tab, text="Token GitHub hanya dipakai untuk trigger workflow_dispatch. Disimpan lokal di config.json.",
                  foreground="#8b97a7", wraplength=900).pack(anchor="w", padx=14, pady=10)

    # ---------- Actions ----------
    def log(self, msg):
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.root.update_idletasks()

    def run_local(self):
        args = self._build_cli_args()
        project_dir = self.var_projdir.get().strip() or str(PROJECT_DIR)
        node_cmd = self.cfg["local"].get("nodeCommand", "npm")
        cmd = [node_cmd, "run", "run:once", "--"] + args
        self.log(f"$ {' '.join(cmd)}  (cwd={project_dir})")
        threading.Thread(target=self._run_subprocess, args=(cmd, project_dir), daemon=True).start()

    def _run_subprocess(self, cmd, cwd):
        try:
            proc = subprocess.Popen(
                cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, shell=(os.name == "nt"))
            for line in proc.stdout:
                self.log(line.rstrip())
            proc.wait()
            self.log(f"--- selesai (exit {proc.returncode}) ---")
            self.root.after(1500, self.refresh_monitor)
        except FileNotFoundError:
            self.log("ERROR: perintah node/npm tidak ditemukan. Cek PATH atau pengaturan.")
        except Exception as exc:  # noqa: BLE001
            self.log(f"ERROR: {exc}")

    def _build_cli_args(self):
        args = [
            "--topic", self.var_topic.get().strip(),
            "--category", self.var_category.get().strip() or "random",
            "--duration", self.var_duration.get().strip() or "360",
            "--scenes", self.var_scenes.get().strip() or "14",
            "--tts-provider", self.var_tts.get().strip() or "openai",
            "--tts-voice", self.var_voice.get().strip() or "cedar",
            "--image-quality", self.var_quality.get().strip() or "low",
            "--force", "true" if self.var_force.get() else "false",
        ]
        return args

    def trigger_github(self):
        repo = self.var_repo.get().strip()
        workflow = self.var_workflow.get().strip()
        ref = self.var_ref.get().strip() or "main"
        token = self.var_token.get().strip()
        if not token:
            messagebox.showwarning("Token kosong", "Isi GitHub token di tab Pengaturan untuk trigger workflow.")
            return
        url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
        payload = {
            "ref": ref,
            "inputs": {
                "topic": self.var_topic.get().strip(),
                "category": self.var_category.get().strip() or "random",
                "duration": self.var_duration.get().strip() or "360",
                "scenes": self.var_scenes.get().strip() or "14",
                "tts_provider": self.var_tts.get().strip() or "openai",
                "tts_voice": self.var_voice.get().strip() or "cedar",
                "image_quality": self.var_quality.get().strip() or "low",
                "force": "true" if self.var_force.get() else "false",
            }
        }
        self.log(f"☁ Trigger {workflow} @ {repo} ({ref})...")
        threading.Thread(target=self._post_github, args=(url, token, payload), daemon=True).start()

    def _post_github(self, url, token, payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (201, 204):
                    self.log("✓ Workflow ter-trigger. Cek tab Actions di GitHub.")
                else:
                    self.log(f"Respon tidak terduga: HTTP {resp.status}")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "ignore")
            self.log(f"ERROR GitHub HTTP {exc.code}: {body[:300]}")
        except Exception as exc:  # noqa: BLE001
            self.log(f"ERROR: {exc}")

    def refresh_monitor(self):
        url = self.var_state_url.get().strip() if hasattr(self, "var_state_url") else self.cfg["stateUrl"]
        self.monitor_status.config(text="Memuat...")
        threading.Thread(target=self._fetch_state, args=(url,), daemon=True).start()

    def _fetch_state(self, url):
        try:
            full = f"{url}?v={int(datetime.now(timezone.utc).timestamp())}"
            req = urllib.request.Request(full, headers={"Cache-Control": "no-store"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            items = data if isinstance(data, list) else data.get("items", [])
            items.sort(key=lambda it: str(it.get("updatedAt") or it.get("createdAt") or ""), reverse=True)
            self.items = items
            self.root.after(0, self._render_tree)
        except Exception as exc:  # noqa: BLE001
            self.root.after(0, lambda: self.monitor_status.config(text=f"Gagal: {exc}"))

    def _render_tree(self):
        for row in self.tree.get_children():
            self.tree.delete(row)
        for it in self.items:
            yt = (it.get("publish") or {}).get("youtube") or {}
            status = "Terupload" if yt.get("url") else (
                "Rendered" if it.get("status") == "rendered" or (it.get("assets") or {}).get("video") else "Draft")
            dur = (it.get("assets") or {}).get("video", {}).get("durationSec")
            self.tree.insert("", "end", values=(
                it.get("title", "(tanpa judul)"),
                status,
                (it.get("input") or {}).get("category", ""),
                f"{round(dur)}s" if dur else "-",
                fmt_date(it.get("createdAt")),
                "✓ buka" if yt.get("url") else "-",
            ), tags=(it.get("id", ""),))
        self.monitor_status.config(text=f"{len(self.items)} video · {fmt_date(datetime.now(timezone.utc).isoformat())}")

    def open_selected_youtube(self, _event):
        sel = self.tree.selection()
        if not sel:
            return
        tags = self.tree.item(sel[0], "tags")
        if not tags:
            return
        item = next((it for it in self.items if it.get("id") == tags[0]), None)
        url = (item or {}).get("publish", {}).get("youtube", {}).get("url")
        if url:
            import webbrowser
            webbrowser.open(url)
        else:
            messagebox.showinfo("Belum ada", "Video ini belum terupload ke YouTube.")

    def save_settings(self):
        self.cfg["stateUrl"] = self.var_state_url.get().strip()
        self.cfg["github"]["repo"] = self.var_repo.get().strip()
        self.cfg["github"]["workflow"] = self.var_workflow.get().strip()
        self.cfg["github"]["ref"] = self.var_ref.get().strip()
        self.cfg["github"]["token"] = self.var_token.get().strip()
        self.cfg["local"]["projectDir"] = self.var_projdir.get().strip()
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(self.cfg, fh, indent=2, ensure_ascii=False)
            messagebox.showinfo("Tersimpan", "Pengaturan disimpan ke app/config.json")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Gagal", str(exc))


def main():
    root = tk.Tk()
    YTStudioApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
