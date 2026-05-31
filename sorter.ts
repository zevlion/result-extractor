import * as cheerio from "cheerio";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Student {
    name: string;
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
    finalScore?: string;
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

export interface Department {
    code: string;
    name: string;
    prefixes: string[];
}

export interface Program {
    pc: string;
    year: number;
    name: string;
    faculty: string;
}

export interface CurriculumCourse {
    code: string;
    name: string;
    credit: number;
    semester: number;
}

// ─── Shared Headers ───────────────────────────────────────────────────────────

const BASE_HEADERS = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    Referer: "https://sis.nileuniversity.edu.ng/my/index.php",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const BASE = "https://sis.nileuniversity.edu.ng/my/index.php";

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parseGrades(html: string, overrideId?: string): GradesResult {
    const $ = cheerio.load(html);

    const student: Student = {
        name: $("li.user-profile a span.hide-menu").text().trim(),
        id: overrideId ?? $("li.user-profile a img").attr("title")?.trim() ?? "",
    };

    const semesters: Semester[] = [];
    let currentSemester: Semester | null = null;

    $("table.table tr").each((_, row) => {
        const cells = $(row).find("td");
        const header = $(row).find("th").first().text().trim();

        if (header && /\d{4}/.test(header) && cells.length === 0) {
            currentSemester = { semester: header, courses: [] };
            semesters.push(currentSemester);
            return;
        }

        if ($(row).attr("style")?.includes("Maroon")) return;

        if (cells.length >= 5 && currentSemester) {
            const course: Course = {
                code: $(cells[0]).text().trim().replace(/^\./, ""),
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

export function parseCurriculumCourses(html: string): string[] {
    const $ = cheerio.load(html);
    const codes = new Set<string>();

    $("table.info-table tbody tr, table.info-table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 3) {
            const clean = $(cells[1]).text().trim().replace(/^\./, "").trim().toUpperCase();
            if (clean && /^[A-Z]{2,4}\s+\d{3}/.test(clean) && !clean.includes("XXX")) {
                codes.add(clean);
            }
        }
    });

    $("table.hover-table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 3) {
            const clean = $(cells[1]).text().trim().replace(/^\./, "").trim().toUpperCase();
            if (clean && /^[A-Z]{2,4}\s+\d{3}/.test(clean) && !clean.includes("XXX")) {
                codes.add(clean);
            }
        }
    });

    return Array.from(codes);
}

export function parseDepartments(html: string): Department[] {
    const $ = cheerio.load(html);
    const deps: Department[] = [];

    $("#example23 tr").each((_, row) => {
        const cells = $("td", row);
        if (cells.length < 4) return;

        const code = $(cells[1]).text().trim();
        const name = $(cells[2]).text().trim();
        const prefixes = $(cells[3]).text().trim()
            .split(",")
            .map((p) => p.trim().replace(/^\./, ""))
            .filter(Boolean);

        if (code) deps.push({ code, name, prefixes });
    });

    return deps;
}

export function parsePrograms(html: string): Program[] {
    const $ = cheerio.load(html);
    const programs: Program[] = [];

    $("table.info-table tr").each((_, row) => {
        const cells = $("td", row);
        if (cells.length < 5) return;

        const year = Number($(cells[1]).text().trim());
        const pc = $(cells[2]).text().trim();
        const name = $(cells[3]).text().trim();
        const faculty = $(cells[4]).text().trim();

        if (pc && year) programs.push({ pc, year, name, faculty });
    });

    return programs;
}

export function parseCurriculumFromProgram(html: string): CurriculumCourse[] {
    const $ = cheerio.load(html);
    const courses: CurriculumCourse[] = [];

    $(".col-lg-6").each((_, col) => {
        const semNum = Number(
            $(col).find("div[style*='font-size:28px']").text().trim()
        );
        if (!semNum) return;

        $("table tr", col).each((_, row) => {
            const cells = $("td", row);
            if (cells.length !== 4) return;

            const code = $(cells[1]).text().trim().replace(/^\./, "").trim().toUpperCase();
            const name = $(cells[2]).text().trim();
            const credit = Number($(cells[3]).text().trim());

            if (!code || code.includes("XXX")) return;
            if (!/^[A-Z]{2,4}\s+\d{3}/.test(code)) return;

            courses.push({ code, name, credit, semester: semNum });
        });
    });

    return courses;
}

// ─── Network ──────────────────────────────────────────────────────────────────

export async function loginAndGetCookie(studentId: string, password: string): Promise<string> {
    const body = new URLSearchParams({ username: studentId, password, LogIn: "LOGIN" });

    const res = await fetch("https://sis.nileuniversity.edu.ng/my/loginAuth.php", {
        method: "POST",
        headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: "https://sis.nileuniversity.edu.ng",
        },
        body: body.toString(),
        redirect: "manual",
    });

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) throw new Error("Authentication failure: no cookie returned.");

    const match = setCookie.match(/PHPSESSID=[^;]+/);
    if (!match) throw new Error("Authentication failure: PHPSESSID not found.");

    return match[0];
}

export async function fetchGrades(cookie: string, studentId?: string): Promise<GradesResult> {
    const url = studentId
        ? `${BASE}?mod=grades&stid=${studentId}`
        : `${BASE}?mod=grades`;

    const res = await fetch(url, {
        method: "GET",
        headers: { ...BASE_HEADERS, Cookie: cookie },
    });

    if (!res.ok) throw new Error(`Fetch grades failed: ${res.status}`);

    const html = await res.text();
    if (html.includes("loginAuth") || html.length < 2500) throw new Error("SESSION_EXPIRED");

    return parseGrades(html, studentId);
}

export async function fetchCurriculumWhitelist(cookie: string): Promise<string[]> {
    const res = await fetch(`${BASE}?mod=course_struct`, {
        method: "GET",
        headers: { ...BASE_HEADERS, Cookie: cookie },
    });

    if (!res.ok) throw new Error(`Fetch course_struct failed: ${res.status}`);
    return parseCurriculumCourses(await res.text());
}

export async function fetchDepartments(cookie: string): Promise<Department[]> {
    const res = await fetch(`${BASE}?mod=viewdeps`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
    });

    if (!res.ok) throw new Error(`Fetch departments failed: ${res.status}`);
    return parseDepartments(await res.text());
}

export async function fetchPrograms(cookie: string, depCode: string): Promise<Program[]> {
    const res = await fetch(`${BASE}?mod=viewdeps&d=${depCode}`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
    });

    if (!res.ok) throw new Error(`Fetch programs failed: ${res.status}`);
    return parsePrograms(await res.text());
}

export async function fetchCurriculumFromProgram(
    cookie: string,
    pc: string,
    py: number
): Promise<CurriculumCourse[]> {
    const res = await fetch(`${BASE}?mod=progman&pc=${pc}&py=${py}`, {
        headers: { ...BASE_HEADERS, Cookie: cookie },
    });

    if (!res.ok) throw new Error(`Fetch curriculum failed: ${res.status}`);
    return parseCurriculumFromProgram(await res.text());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function guessDepartment(
    courseCodes: string[],
    departments: Department[]
): Department[] {
    const prefixes = new Set(
        courseCodes.map((c) => c.replace(/^\./, "").split(" ")[0].trim().toUpperCase())
    );

    return departments
        .map((dep) => ({
            dep,
            matches: dep.prefixes.filter((p) => prefixes.has(p.toUpperCase())).length,
        }))
        .filter((x) => x.matches > 0)
        .sort((a, b) => b.matches - a.matches)
        .map((x) => x.dep);
}

// ─── Sorter ───────────────────────────────────────────────────────────────────

const GRADE_POINTS: Record<string, number> = {
    A: 5, B: 4, C: 3, D: 2, E: 1, F: 0, IP: -1,
};

export function sortGrades(
    semesters: Semester[],
    sortBy: "code" | "name" | "grade" | "credit" = "code",
    order: "asc" | "desc" = "asc"
): Semester[] {
    return semesters.map((sem) => ({
        ...sem,
        courses: [...sem.courses].sort((a, b) => {
            const valA = sortBy === "grade" ? (GRADE_POINTS[a.grade] ?? -1)
                : sortBy === "credit" ? a.credit
                    : (a[sortBy] ?? "").toLowerCase();
            const valB = sortBy === "grade" ? (GRADE_POINTS[b.grade] ?? -1)
                : sortBy === "credit" ? b.credit
                    : (b[sortBy] ?? "").toLowerCase();

            if (valA < valB) return order === "asc" ? -1 : 1;
            if (valA > valB) return order === "asc" ? 1 : -1;
            return 0;
        }),
    }));
}