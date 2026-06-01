import * as cheerio from "cheerio";
import type { Assessment, Course } from "./sorter.ts";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;
const FETCH_DELAY_MS = 2000;
const TIMEOUT_MS = 12000;

export async function fetchAllCourseDetails(
  courses: Course[],
  studentId: string,
  yearTerm: number,
  cookie: string
): Promise<Course[]> {
  const results: Course[] = [];

  for (const course of courses) {
    await sleep(FETCH_DELAY_MS);
    const enriched = await fetchCourseDetails(course, studentId, yearTerm, cookie);
    results.push(enriched!);
  }

  return results;
}

export async function fetchCourseDetails(
  course: Course,
  studentId: string,
  yearTerm: number,
  cookie: string,
  attempt = 0
): Promise<Course | undefined> {
  const paddedSection = course.section.trim().padStart(2, "0");
  const body =
    `ajx=1&mod=grader&action=GetDetails` +
    `&did=${encodeURIComponent(course.code)}` +
    `&sid=${encodeURIComponent(paddedSection)}` +
    `&stid=${studentId}` +
    `&yt=${yearTerm}` +
    `&${Date.now()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://sis.nileuniversity.edu.ng/my/index.php", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://sis.nileuniversity.edu.ng/my/index.php?mod=grades",
        Origin: "https://sis.nileuniversity.edu.ng",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120.0.0.0 Safari/537.36",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) return course;

    const text = await res.text();

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return course;
    }

    if (String(json.CODE) !== "1" || !json.DATA) return course;

    return parseCourseDetail(course, json.DATA);

  } catch (err: any) {
    clearTimeout(timeoutId);

    const isRetryable =
      err.name === "AbortError" ||
      err.message?.includes("Connection reset") ||
      err.message?.includes("socket");

    if (isRetryable && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      return fetchCourseDetails(course, studentId, yearTerm, cookie, attempt + 1);
    }

    if (err.name === "AbortError") {
      return course;
    }
  }

  function parseCourseDetail(course: Course, html: string): Course {
    const $ = cheerio.load(html);
    const assessments: Assessment[] = [];
    let lecturer: string | undefined;
    let attendance: string | undefined;

    $("table:not(.table) tr").each((_, row) => {
      const cells = $("td", row);
      if (cells.length < 2) return;

      const label = $(cells[0]).text().trim().toLowerCase();
      if (label.includes("lecturer")) {
        lecturer = $(cells[1]).text().trim();
      }
      if (label.includes("attendance")) {
        attendance = $(cells[1]).find(".progress-bar").text().trim();
      }
    });

    $("table.table tr").each((_, row) => {
      const cells = $("td", row);
      if (cells.length !== 3) return;

      const type = $(cells[0]).text().trim();
      const percentage = $(cells[1]).text().trim();
      const score = $(cells[2]).text().trim();

      if (!type || !percentage || !score) return;

      assessments.push({
        type,
        percentage,
        score: isNaN(Number(score)) ? score : Number(score),
      });
    });

    const badge = $(".btn-rounded").text().trim();
    let finalScore: string | undefined;
    let finalGrade = course.grade;

    if (badge.includes("-")) {
      const [s, g] = badge.split("-");
      finalScore = s?.trim();
      finalGrade = g?.trim() ?? course.grade;
    } else if (badge) {
      finalGrade = badge;
    }

    return {
      ...course,
      grade: finalGrade,
      lecturer,
      attendance,
      assessments,
      ...(finalScore && { finalScore }),
    };
  }
}