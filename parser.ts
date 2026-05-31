// parser.ts

import * as cheerio from "cheerio";

export interface Student {
  id: string;
}

export interface Assessment {
  type: string;
  percentage: string;
  score: string | number;
}

export interface Course {
  code: string;
  name: string;
  grade: string;
  section: string;
  credit: number;
  lecturer?: string;
  attendance?: string;
  assessments?: Assessment[];
}

export interface Semester {
  semester: string;
  courses: Course[];
}

export interface GradesResult {
  student: Student;
  semesters: Semester[];
}

export function parseGrades(html: string): GradesResult {
  const $ = cheerio.load(html);

  const studentId = $("li.user-profile a img").attr("title")?.trim() ?? "";

  const student: Student = {
    id: studentId,
  };

  // --- Transcript table ---
  const semesters: Semester[] = [];
  let currentSemester: Semester | null = null;

  $("table.table tr").each((_, row) => {
    const cells = $(row).find("td");
    const header = $(row).find("th").first().text().trim();

    // Semester header e.g. "2025 - 2026. 1"
    if (header && /\d{4}/.test(header) && cells.length === 0) {
      currentSemester = { semester: header, courses: [] };
      semesters.push(currentSemester);
      return;
    }

    // CGPA footer row — skip
    if ($(row).attr("style")?.includes("Maroon")) return;

    // Course row
    if (cells.length >= 5 && currentSemester) {
      const course: Course = {
        code: $(cells[0]).text().trim(),
        name: $(cells[1]).text().trim(),
        grade: $(cells[2]).text().trim(),
        section: $(cells[3]).text().trim(),
        credit: Number($(cells[4]).text().trim()),
      };
      if (course.code) currentSemester.courses.push(course);
    }
  });

  return { student, semesters };
}