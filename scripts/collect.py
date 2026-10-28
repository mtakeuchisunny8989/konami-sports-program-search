"""
コナミスポーツクラブ プログラム検索ページから、直近1週間の全国スタジオプログラム情報を収集し、
data/programs.json に正規化して保存する。

データ元: https://information.konamisportsclub.jp/ksc/search_program/
  - 都道府県/施設一覧は検索ページHTML内の `var PREFECTURE_DATA = [...]` に埋め込まれている。
  - 検索結果はAPIではなく、同URLへのGETでHTML全体が返るサーバーサイドレンダリング方式。
  - prefectureName/facilityName を両方空欄にすると全国分の結果が1つの検索結果(ページ送り)として
    取得できる(UI上は都道府県選択必須に見えるが、バックエンドは制限していない)。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import random
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, date, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://information.konamisportsclub.jp/ksc/search_program/"
USER_AGENT = "KonamiSportsClubProgramSearch/1.0 (personal, non-commercial lookup tool)"
REQUEST_DELAY_RANGE = (1.5, 2.5)  # 秒。サーバー負荷に配慮し必ず間隔を空ける
RESULTS_PER_PAGE = 30
MAX_RETRIES = 3
RETRY_BACKOFF = 5.0

JST = timezone(timedelta(hours=9))

WEEKDAY_KANJI = ["月", "火", "水", "木", "金", "土", "日"]

SCHEDULE_RE = re.compile(
    r"(?P<month>\d{1,2})\.(?P<day>\d{1,2})\((?P<weekday>[月火水木金土日])(?:・祝)?\)\s*"
    r"(?P<start>\d{2}:\d{2})~(?P<end>\d{2}:\d{2})（(?P<duration>\d+)分）"
)
TOTAL_COUNT_RE = re.compile(r"全(\d+)件中")
FACILITY_CODE_RE = re.compile(r"/ksc/(\d+)/")
PREF_DATA_RE = re.compile(r"var\s+PREFECTURE_DATA\s*=\s*(\[.*?\]);", re.DOTALL)


@dataclass
class FetchFailure:
    page: int
    error: str


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def polite_sleep() -> None:
    time.sleep(random.uniform(*REQUEST_DELAY_RANGE))


def fetch(session: requests.Session, params: dict) -> str:
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(BASE_URL, params=params, timeout=20)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            return resp.text
        except requests.RequestException as e:
            last_err = e
            log(f"  取得失敗 (試行{attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF * attempt)
    raise RuntimeError(str(last_err))


def extract_facilities(html: str) -> list[dict]:
    m = PREF_DATA_RE.search(html)
    if not m:
        raise RuntimeError("PREFECTURE_DATA が見つかりません。サイト構造が変更された可能性があります。")
    prefecture_data = json.loads(m.group(1))

    facilities = []
    for pref in prefecture_data:
        pref_name = pref["text"]
        pref_code = pref["value"]
        for fac in pref.get("facility", []):
            facilities.append(
                {
                    "code": fac["value"],
                    "name": fac["text"],
                    "prefecture": pref_name,
                    "prefecture_code": pref_code,
                    "url": f"https://information.konamisportsclub.jp/ksc/{fac['value']}/",
                }
            )
    return facilities


def resolve_date(month: int, day: int, today: date) -> date:
    """"M.DD"形式の日付(年なし)を、収集日を基準に直近の年へ解決する。
    年末年始をまたいで翌年の日付が出るケースを吸収するため、収集日の3日前より
    過去になる場合は翌年とみなす。"""
    candidate = date(today.year, month, day)
    if candidate < today - timedelta(days=3):
        candidate = date(today.year + 1, month, day)
    return candidate


def parse_results_page(html: str, today: date) -> tuple[list[dict], int]:
    soup = BeautifulSoup(html, "html.parser")

    total_count = 0
    m = TOTAL_COUNT_RE.search(soup.get_text())
    if m:
        total_count = int(m.group(1))

    table = soup.select_one("table.tbl")
    programs = []
    if table:
        tbody = table.select_one("tbody")
        rows = tbody.select("tr") if tbody else []
        for tr in rows:
            cells = tr.find_all("td")
            if len(cells) < 4:
                continue

            facility_cell, program_cell, schedule_cell, instructor_cell = cells[:4]

            link = facility_cell.find("a")
            facility_url = link["href"] if link and link.has_attr("href") else None
            facility_code = None
            if facility_url:
                fm = FACILITY_CODE_RE.search(facility_url)
                if fm:
                    facility_code = fm.group(1)
            facility_name = facility_cell.get_text(strip=True)

            program_name = program_cell.get_text(strip=True)
            instructor = instructor_cell.get_text(strip=True)

            schedule_text = schedule_cell.get_text(strip=True)
            sm = SCHEDULE_RE.search(schedule_text)
            if not sm:
                log(f"  スケジュール文字列を解析できません: {schedule_text!r} (スキップ)")
                continue

            month = int(sm.group("month"))
            day = int(sm.group("day"))
            resolved_date = resolve_date(month, day, today)
            is_holiday = "・祝" in schedule_text

            programs.append(
                {
                    "facility_code": facility_code,
                    "facility_name": facility_name,
                    "facility_url": (
                        f"https://information.konamisportsclub.jp{facility_url}"
                        if facility_url and facility_url.startswith("/")
                        else facility_url
                    ),
                    "program_name": program_name,
                    "instructor": instructor,
                    "date": resolved_date.isoformat(),
                    "weekday": WEEKDAY_KANJI[resolved_date.weekday()],
                    "is_holiday": is_holiday,
                    "start_time": sm.group("start"),
                    "end_time": sm.group("end"),
                    "duration_min": int(sm.group("duration")),
                }
            )

    return programs, total_count


def collect_all_programs(
    session: requests.Session, today: date, max_pages: int | None = None
) -> tuple[list[dict], list[FetchFailure]]:
    base_params = {
        "programName": "",
        "prefectureName": "",
        "facilityName": "",
        "day": ["1", "2", "3", "4", "5", "6", "7"],
        "allDay": "on",
        "startTime": "",
        "endTime": "",
    }

    log("1ページ目を取得して総件数を確認します...")
    html = fetch(session, {**base_params, "page": 1})
    programs, total_count = parse_results_page(html, today)
    log(f"総件数: {total_count}件")

    total_pages = max(1, math.ceil(total_count / RESULTS_PER_PAGE))
    if max_pages is not None:
        total_pages = min(total_pages, max_pages)
        log(f"(テストモード: 最大{total_pages}ページまでに制限)")
    failures: list[FetchFailure] = []

    for page in range(2, total_pages + 1):
        polite_sleep()
        log(f"ページ {page}/{total_pages} を取得中...")
        try:
            html = fetch(session, {**base_params, "page": page})
        except RuntimeError as e:
            log(f"  ページ {page} の取得を諦めてスキップします: {e}")
            failures.append(FetchFailure(page=page, error=str(e)))
            continue

        page_programs, _ = parse_results_page(html, today)
        if not page_programs and page < total_pages:
            log(f"  ページ {page} に結果が0件でした(想定外)。解析失敗の可能性があります。")
        programs.extend(page_programs)

    return programs, failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="取得するページ数の上限(動作確認用。未指定なら全ページ=全施設を取得)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="出力先JSONパス(省略時は data/programs.json)",
    )
    args = parser.parse_args()

    out_path = args.out or (Path(__file__).resolve().parent.parent / "data" / "programs.json")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.5"})

    now_jst = datetime.now(JST)
    today = now_jst.date()

    log("施設一覧(都道府県/施設コード対応表)を取得します...")
    top_html = fetch(session, {})
    facilities = extract_facilities(top_html)
    log(f"施設数: {len(facilities)}件")

    programs, failures = collect_all_programs(session, today, max_pages=args.max_pages)

    data = {
        "fetched_at": now_jst.isoformat(),
        "source_url": BASE_URL,
        "facility_count": len(facilities),
        "program_count": len(programs),
        "failed_pages": [f.page for f in failures],
        "facilities": facilities,
        "programs": programs,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # モバイル回線での読み込み量を抑えるため、整形せずコンパクトに出力する
    out_path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    log(f"完了: プログラム {len(programs)}件 / 施設 {len(facilities)}件 を {out_path} に保存しました。")
    if failures:
        log(f"警告: {len(failures)}ページの取得に失敗しスキップしました: {[f.page for f in failures]}")


if __name__ == "__main__":
    main()
