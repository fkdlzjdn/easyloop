#!/usr/bin/env python3
"""
EasyLoop Launcher
- 서버 시작/중지
- 상태 표시 (주기적 체크)
- 브라우저 열기
- 창 종료 시 서버 자동 종료
- 단일 인스턴스 보장
"""

import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import threading
import webbrowser
import os
import signal
import sys
import socket

# 단일 인스턴스 확인용 포트
SINGLE_INSTANCE_PORT = 47391


def check_single_instance():
    """
    단일 인스턴스 확인.
    이미 실행 중이면 기존 창 활성화 요청 후 종료.
    """
    try:
        # 소켓 서버 시작 시도
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('127.0.0.1', SINGLE_INSTANCE_PORT))
        sock.listen(1)
        return sock  # 성공 - 첫 번째 인스턴스
    except OSError:
        # 이미 실행 중 - 기존 인스턴스에 활성화 요청
        try:
            client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            client.connect(('127.0.0.1', SINGLE_INSTANCE_PORT))
            client.send(b'FOCUS')
            client.close()
        except:
            pass
        return None  # 종료해야 함


class EasyLoopLauncher:
    def __init__(self, instance_socket=None):
        self.instance_socket = instance_socket

        self.root = tk.Tk()
        self.root.title("EasyLoop")
        self.root.geometry("400x320")
        self.root.resizable(False, False)

        # Dark theme colors
        self.bg_color = "#1a1a2e"
        self.fg_color = "#ffffff"
        self.accent_color = "#e94560"
        self.success_color = "#27ae60"
        self.danger_color = "#c0392b"
        self.warning_color = "#f39c12"

        self.root.configure(bg=self.bg_color)

        self.server_process = None
        self.server_running = False
        try:
            configured_port = int(os.environ.get("PORT", "3000"))
            self.port = configured_port if 1 <= configured_port <= 65535 else 3000
        except ValueError:
            self.port = 3000
        self.check_interval = 1000  # 1초마다 체크

        self.setup_ui()

        # 창 종료 시 서버 자동 종료 (확인 없이)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # 시작 시 기존 서버 체크
        self.check_existing_server()

        # 주기적 상태 체크 시작
        self.periodic_check()

        # 단일 인스턴스 리스너 시작
        if self.instance_socket:
            self.start_instance_listener()

    def setup_ui(self):
        # Title
        title_frame = tk.Frame(self.root, bg=self.bg_color)
        title_frame.pack(pady=20)

        title_label = tk.Label(
            title_frame,
            text="EasyLoop",
            font=("Arial", 24, "bold"),
            fg=self.accent_color,
            bg=self.bg_color
        )
        title_label.pack()

        subtitle_label = tk.Label(
            title_frame,
            text="AMR Mapping & Loop Closure",
            font=("Arial", 10),
            fg="#888888",
            bg=self.bg_color
        )
        subtitle_label.pack()

        # Status
        status_frame = tk.Frame(self.root, bg=self.bg_color)
        status_frame.pack(pady=15)

        tk.Label(
            status_frame,
            text="Server Status:",
            font=("Arial", 12),
            fg=self.fg_color,
            bg=self.bg_color
        ).pack(side=tk.LEFT, padx=5)

        self.status_label = tk.Label(
            status_frame,
            text="● Stopped",
            font=("Arial", 12, "bold"),
            fg=self.danger_color,
            bg=self.bg_color
        )
        self.status_label.pack(side=tk.LEFT, padx=5)

        # PID info
        self.pid_label = tk.Label(
            self.root,
            text="PID: -",
            font=("Arial", 9),
            fg="#666666",
            bg=self.bg_color
        )
        self.pid_label.pack()

        # URL
        self.url_label = tk.Label(
            self.root,
            text=f"http://localhost:{self.port}",
            font=("Arial", 11),
            fg="#888888",
            bg=self.bg_color
        )
        self.url_label.pack(pady=5)

        # Buttons
        button_frame = tk.Frame(self.root, bg=self.bg_color)
        button_frame.pack(pady=15)

        self.start_btn = tk.Button(
            button_frame,
            text="Start Server",
            font=("Arial", 12),
            width=12,
            bg=self.success_color,
            fg=self.fg_color,
            activebackground="#2ecc71",
            activeforeground=self.fg_color,
            relief=tk.FLAT,
            cursor="hand2",
            command=self.start_server
        )
        self.start_btn.pack(side=tk.LEFT, padx=10)

        self.stop_btn = tk.Button(
            button_frame,
            text="Stop Server",
            font=("Arial", 12),
            width=12,
            bg=self.danger_color,
            fg=self.fg_color,
            activebackground="#e74c3c",
            activeforeground=self.fg_color,
            relief=tk.FLAT,
            cursor="hand2",
            command=self.stop_server,
            state=tk.DISABLED
        )
        self.stop_btn.pack(side=tk.LEFT, padx=10)

        # Open Browser Button
        self.browser_btn = tk.Button(
            self.root,
            text="Open in Browser",
            font=("Arial", 11),
            width=20,
            bg="#0f3460",
            fg=self.fg_color,
            activebackground="#16213e",
            activeforeground=self.fg_color,
            relief=tk.FLAT,
            cursor="hand2",
            command=self.open_browser,
            state=tk.DISABLED
        )
        self.browser_btn.pack(pady=10)

        # Log area
        log_frame = tk.Frame(self.root, bg=self.bg_color)
        log_frame.pack(pady=10, fill=tk.X, padx=20)

        self.log_label = tk.Label(
            log_frame,
            text="Ready to start server...",
            font=("Arial", 9),
            fg="#666666",
            bg=self.bg_color,
            wraplength=360
        )
        self.log_label.pack()

    def is_port_in_use(self):
        """포트가 사용 중인지 체크"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('localhost', self.port)) == 0

    def find_available_port(self, start_port=None):
        """요청 포트부터 순서대로 비어 있는 포트를 찾는다."""
        port = start_port if start_port is not None else self.port
        while port <= 65535:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                try:
                    sock.bind(('0.0.0.0', port))
                    return port
                except OSError:
                    port += 1
        raise RuntimeError(f"No available port after {start_port}")

    def update_url(self):
        self.url_label.config(text=f"http://localhost:{self.port}")

    def get_pid_on_port(self):
        """포트를 사용 중인 프로세스 PID 반환"""
        try:
            result = subprocess.run(
                ["lsof", "-t", f"-i:{self.port}"],
                capture_output=True,
                text=True
            )
            pids = result.stdout.strip().split('\n')
            return [int(p) for p in pids if p.isdigit()]
        except:
            return []

    def check_existing_server(self):
        """시작 시 기존 서버 체크"""
        if self.is_port_in_use():
            occupied_port = self.port
            self.port = self.find_available_port(self.port + 1)
            self.update_url()
            self.log(f"Port {occupied_port} is in use; ready on {self.port}")
        self.update_status(False, None)

    def periodic_check(self):
        """주기적으로 서버 상태 체크"""
        try:
            port_in_use = self.is_port_in_use()

            # 우리가 시작한 프로세스 체크
            if self.server_process:
                if self.server_process.poll() is not None:
                    # 프로세스 종료됨
                    self.server_process = None
                    self.server_running = False

            if port_in_use:
                pids = self.get_pid_on_port()
                pid = pids[0] if pids else None

                if not self.server_running:
                    self.server_running = True
                    self.update_status(True, pid)
                else:
                    # PID만 업데이트
                    self.pid_label.config(text=f"PID: {pid if pid else 'unknown'}")
            else:
                if self.server_running:
                    self.server_running = False
                    self.update_status(False, None)
                    self.log("Server stopped unexpectedly")
        except Exception as e:
            pass

        # 다음 체크 예약
        self.root.after(self.check_interval, self.periodic_check)

    def start_server(self):
        if self.server_running:
            self.log("Server already running")
            return

        requested_port = self.port
        self.port = self.find_available_port(requested_port)
        self.update_url()
        if self.port != requested_port:
            self.log(f"Port {requested_port} is in use; starting on {self.port}...")
        else:
            self.log(f"Starting server on port {self.port}...")

        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))

        try:
            server_env = os.environ.copy()
            server_env["PORT"] = str(self.port)
            self.server_process = subprocess.Popen(
                ["node", "server.js"],
                cwd=script_dir,
                env=server_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                preexec_fn=os.setsid
            )

            # Wait a bit and check if server started
            self.root.after(1500, self.check_server_started)

        except Exception as e:
            self.log(f"Error: {str(e)}")
            messagebox.showerror("Error", f"Failed to start server:\n{str(e)}")

    def check_server_started(self):
        if self.server_process and self.server_process.poll() is None:
            self.server_running = True
            self.update_status(True, self.server_process.pid)
            self.log(f"Server started on port {self.port} (PID: {self.server_process.pid})")
        else:
            self.log("Failed to start server")
            self.server_process = None

    def stop_server(self):
        self.log("Stopping server...")

        try:
            # 우리가 시작한 프로세스가 있으면 종료
            if self.server_process:
                try:
                    os.killpg(os.getpgid(self.server_process.pid), signal.SIGTERM)
                    self.server_process.wait(timeout=3)
                except:
                    try:
                        self.server_process.kill()
                    except:
                        pass
                self.server_process = None

            # 포트를 사용하는 모든 프로세스 종료
            pids = self.get_pid_on_port()
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                except:
                    pass

        except Exception as e:
            self.log(f"Error stopping: {str(e)}")

        self.server_running = False
        self.update_status(False, None)
        self.log("Server stopped")

    def update_status(self, running, pid=None):
        if running:
            self.status_label.config(text="● Running", fg=self.success_color)
            self.pid_label.config(text=f"PID: {pid if pid else 'unknown'}")
            self.start_btn.config(state=tk.DISABLED)
            self.stop_btn.config(state=tk.NORMAL)
            self.browser_btn.config(state=tk.NORMAL)
        else:
            self.status_label.config(text="● Stopped", fg=self.danger_color)
            self.pid_label.config(text="PID: -")
            self.start_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.DISABLED)
            self.browser_btn.config(state=tk.DISABLED)

    def open_browser(self):
        webbrowser.open(f"http://localhost:{self.port}")

    def log(self, message):
        self.log_label.config(text=message)

    def on_close(self):
        """창 종료 시 확인 후 서버 종료"""
        if self.server_running:
            if messagebox.askokcancel(
                "EasyLoop",
                "서버가 실행 중입니다.\n종료 시 모든 연결이 해제됩니다.\n\n계속하시겠습니까?"
            ):
                self.log("Shutting down server...")
                self.stop_server()
                self.root.destroy()
            # No를 선택하면 아무것도 하지 않음 (창 유지)
        else:
            self.root.destroy()

    def start_instance_listener(self):
        """다른 인스턴스로부터 FOCUS 요청 수신"""
        def listener():
            while True:
                try:
                    conn, addr = self.instance_socket.accept()
                    data = conn.recv(1024)
                    conn.close()
                    if data == b'FOCUS':
                        # UI 스레드에서 창 활성화
                        self.root.after(0, self.bring_to_front)
                except:
                    break

        thread = threading.Thread(target=listener, daemon=True)
        thread.start()

    def bring_to_front(self):
        """창을 맨 앞으로 가져오기"""
        self.root.deiconify()  # 최소화 해제
        self.root.lift()  # 맨 위로
        self.root.focus_force()  # 포커스
        self.root.attributes('-topmost', True)  # 최상위
        self.root.after(100, lambda: self.root.attributes('-topmost', False))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    # 단일 인스턴스 확인
    instance_socket = check_single_instance()

    if instance_socket is None:
        # 이미 실행 중 - 기존 창 활성화 요청 보냄, 종료
        sys.exit(0)

    # 첫 번째 인스턴스 - 정상 실행
    app = EasyLoopLauncher(instance_socket)
    app.run()
