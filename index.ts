import { parseArgs } from "util";
import { fetchCourseDetails } from "./details.ts";
import {
    fetchGrades,
    sortGrades,
    loginAndGetCookie,
    fetchCurriculumWhitelist,
    fetchDepartments,
    fetchPrograms,
    fetchCurriculumFromProgram,
    guessDepartment,
    type CurriculumCourse,
    type Semester,
    type Course,
} from "./sorter.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIG_FILE = ".env.json";
const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 250;

// ─── Config ───────────────────────────────────────────────────────────────────

interface Config {
    cookie?: string;
}

async function loadConfig(): Promise<Config> {
    try {
        const file = Bun.file(CONFIG_FILE);
        if (await file.exists()) return await file.json();
    } catch { }
    return {};
}

async function saveConfig(config: Config): Promise<void> {
    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Args ─────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        cookie: { type: "string" }, // --cookie "PHPSESSID=..."
        id: { type: "string" }, // --id 253040036
        dep: { type: "string" }, // --dep D_SEN  (skip department prompt)
        pc: { type: "string" }, // --pc 11601   (skip program prompt)
        py: { type: "string" }, // --py 2025    (override program year)
    },
    strict: true,
});

let config = await loadConfig();
if (values.cookie) {
    config.cookie = values.cookie;
    await saveConfig(config);
    console.log("✅ Cookie saved to .env.json");
}

let COOKIE = config.cookie;
const STUDENT_ID = values.id;

// ─── Prompt ───────────────────────────────────────────────────────────────────

async function promptUser(query: string, hideInput = false): Promise<string> {
    process.stdout.write(query);

    if (hideInput) {
        // @ts-ignore
        process.stdin.setRawMode?.(true);
        let input = "";
        for await (const chunk of process.stdin) {
            const str = chunk.toString();
            if (str === "\n" || str === "\r") {
                process.stdout.write("\n");
                break;
            }
            if (str === "\u0003") process.exit(0);
            input += str;
        }
        // @ts-ignore
        process.stdin.setRawMode?.(false);
        return input.trim();
    } else {
        for await (const line of console) return line.trim();
    }
    return "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toYearTerm(label: string): number {
    const year = label.match(/\d{4}/)?.[0] ?? "0";
    let term = "1";
    const termMatch = label.match(/\.\s*(\d)/);
    if (termMatch) term = termMatch[1]!;
    else if (/second/i.test(label) || /\.2/.test(label)) term = "2";
    else if (/summer/i.test(label) || /\.3/.test(label)) term = "3";
    return Number(`${year}${term}`);
}

function getEntryYear(studentId: string): number {
    const prefix = studentId.substring(0, 2);
    if (/^\d{2}$/.test(prefix)) {
        return 2000 + Number(prefix);
    }
    return new Date().getFullYear();
}

async function fetchCourseDetailsBySearching(
    course: Course,
    studentId: string,
    idealYearTerm: number,
    startYear: number,
    currentYear: number,
    cookie: string
): Promise<Course> {
    const term = idealYearTerm % 10;
    const idealYear = Math.floor(idealYearTerm / 10);

    const yearTerms = [];
    for (let y = idealYear; y <= currentYear; y++) {
        yearTerms.push(y * 10 + term);
        yearTerms.push(y * 10 + 3); // LVS
    }
    const uniqueYts = Array.from(new Set(yearTerms)).sort((a, b) => b - a);

    const sections = ["01", "02", "03", "04", "05", "06", "07", "08"];

    for (const yt of uniqueYts) {
        const fetched = await Promise.all(
            sections.map(async (sec) => {
                const tempCourse = { ...course, section: sec };
                try {
                    const res = await fetchCourseDetails(tempCourse, studentId, yt, cookie);
                    const hasData =
                        res.lecturer ||
                        res.assessments?.length ||
                        res.finalScore ||
                        (res.grade && res.grade !== "IP" && res.grade !== "");
                    return { hasData, res };
                } catch {
                    return { hasData: false, res: tempCourse };
                }
            })
        );

        const matched = fetched.find((f) => f.hasData);
        if (matched) {
            return matched.res;
        }
    }

    return {
        ...course,
        section: "01",
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
    // ─── Auth & Grades ──────────────────────────────────────────────────────────

    let gradesData;
    try {
        if (!COOKIE) throw new Error("SESSION_EXPIRED");
        console.log("🚀 Fetching transcript...");
        gradesData = await fetchGrades(COOKIE, STUDENT_ID);
    } catch (err: any) {
        if (err.message === "SESSION_EXPIRED") {
            console.warn("\n⚠️  Session expired or missing. Please log in.");
            const username = await promptUser("👤 Student ID: ");
            const password = await promptUser("🔒 Password: ", true);

            if (!username || !password) {
                console.error("❌ Credentials cannot be blank.");
                process.exit(1);
            }

            COOKIE = await loginAndGetCookie(username, password);
            config.cookie = COOKIE;
            await saveConfig(config);
            console.log("✅ Session saved to .env.json");

            gradesData = await fetchGrades(COOKIE, STUDENT_ID);
        } else {
            throw err;
        }
    }

    const { student, semesters } = gradesData;

    console.log("\n👤 Student");
    console.table(student);

    // ─── Department Selection ───────────────────────────────────────────────────

    let curriculumCourses: CurriculumCourse[] = [];
    let curriculumWhitelist: string[] = [];

    console.log("\n🔍 Loading departments...");
    const departments = await fetchDepartments(COOKIE!);
    console.log(`   Found ${departments.length} departments.`);

    const allCodes = semesters.flatMap((s) => s.courses.map((c) => c.code));
    const guessed = guessDepartment(allCodes, departments);

    let selectedDepCode = values.dep;

    if (!selectedDepCode) {
        if (guessed.length > 0) {
            console.log("\n🏫 Likely department(s) based on your course codes:");
            guessed.slice(0, 5).forEach((d, i) =>
                console.log(`  ${i + 1}. [${d.code}] ${d.name}`)
            );
        }

        console.log("\n📋 All departments:");
        departments.forEach((d, i) =>
            console.log(`  ${String(i + 1).padStart(2)}. [${d.code}] ${d.name}`)
        );

        const depInput = await promptUser(
            "\nEnter department number or code (e.g. D_SEN), or press Enter to skip: "
        );

        if (depInput) {
            if (/^\d+$/.test(depInput)) {
                const idx = Number(depInput) - 1;
                if (guessed.length > 0 && idx >= 0 && idx < guessed.length) {
                    selectedDepCode = guessed[idx]?.code ?? "";
                } else {
                    selectedDepCode = departments[idx]?.code ?? "";
                }
            } else {
                selectedDepCode = depInput.trim();
            }
        }
    }

    // ─── Program Selection ──────────────────────────────────────────────────────

    if (selectedDepCode) {
        const selectedDep = departments.find((d) => d.code === selectedDepCode);
        if (!selectedDep) {
            console.warn(`⚠️  Department "${selectedDepCode}" not found. Skipping curriculum.`);
        } else {
            console.log(`\n✅ Department: [${selectedDep.code}] ${selectedDep.name}`);

            console.log("   Loading programs...");
            const programs = await fetchPrograms(COOKIE!, selectedDepCode);

            const latestYear = values.py
                ? Number(values.py)
                : Math.max(...programs.map((p) => p.year));

            const latestPrograms = programs.filter((p) => p.year === latestYear);

            let selectedPc = values.pc;

            if (!selectedPc) {
                console.log(`\n📚 Programs available (${latestYear}):`);
                latestPrograms.forEach((p, i) =>
                    console.log(`  ${i + 1}. ${p.name}  [pc=${p.pc}]  —  ${p.faculty}`)
                );

                const progInput = await promptUser(
                    "\n⚠️  Select the program this student is enrolled in (enter number).\n" +
                    "   Wrong selection = incomplete or incorrect course mapping.\n> "
                );

                const progIdx = Number(progInput) - 1;
                selectedPc = latestPrograms[progIdx]?.pc;
            }

            if (!selectedPc) {
                console.warn("⚠️  No program selected. Skipping curriculum.");
            } else {
                const prog = programs.find((p) => p.pc === selectedPc);
                console.log(`\n✅ Program: ${prog?.name ?? selectedPc} [pc=${selectedPc}]`);

                console.log("   Loading curriculum...");
                curriculumCourses = await fetchCurriculumFromProgram(COOKIE!, selectedPc, latestYear);
                curriculumWhitelist = curriculumCourses.map((c) => c.code);
                console.log(`📖 Loaded ${curriculumCourses.length} courses from curriculum.`);
            }

            if (curriculumWhitelist.length === 0) {
                console.log(`   Filtering results to courses matching department prefixes [${selectedDep.prefixes.join(", ")}]...`);
                const depPrefixes = selectedDep.prefixes.map((p) => p.toUpperCase());
                curriculumWhitelist = allCodes
                    .map((code) => code.replace(/^\./, "").trim().toUpperCase())
                    .filter((cleanCode) => {
                        const prefix = cleanCode.split(" ")[0];
                        return depPrefixes.includes(prefix!);
                    });
                console.log(`   Found ${curriculumWhitelist.length} matching courses.`);
            }
        }
    } else {
        // Fallback: use course_struct whitelist
        console.log("\n🔍 No department selected — falling back to course_struct whitelist...");
        curriculumWhitelist = await fetchCurriculumWhitelist(COOKIE!);
        console.log(`   Loaded ${curriculumWhitelist.length} course references.`);
    }

    let semestersToProcess = semesters;

    if (curriculumCourses.length > 0) {
        console.log(`\n📋 Constructing semester list from program curriculum courses...`);
        const startYear = values.py ? Number(values.py) : getEntryYear(STUDENT_ID ?? student.id);

        const semGroups: Record<number, CurriculumCourse[]> = {};
        for (const c of curriculumCourses) {
            if (!semGroups[c.semester]) semGroups[c.semester] = [];
            semGroups[c.semester]?.push(c);
        }

        const semestersFromCurriculum: Semester[] = [];
        for (const semNum of Object.keys(semGroups).map(Number).sort((a, b) => a - b)) {
            const courses = semGroups[semNum]!;
            const yearOffset = Math.floor((semNum - 1) / 2);
            const term = (semNum - 1) % 2 === 0 ? 1 : 2;
            const year = startYear + yearOffset;
            const semesterLabel = `${year} - ${year + 1}. ${term}`;

            semestersFromCurriculum.push({
                semester: semesterLabel,
                courses: courses.map((c) => ({
                    code: c.code,
                    name: c.name,
                    grade: "",
                    section: "01",
                    credit: c.credit,
                })),
            });
        }
        semestersToProcess = semestersFromCurriculum;
    }

    // ─── Enrich Courses ─────────────────────────────────────────────────────────

    console.log("\n⚡ Fetching course details...");

    for (const sem of semestersToProcess) {
        const yt = toYearTerm(sem.semester);

        const validCourses = sem.courses;

        if (validCourses.length === 0) {
            sem.courses = [];
            continue;
        }

        console.log(`\n📚 ${sem.semester}`);
        const enriched = [];

        for (let i = 0; i < validCourses.length; i += BATCH_SIZE) {
            const chunk = validCourses.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
                chunk.map((c) => {
                    console.log(`   [FETCH] ${c.code}`);
                    if (curriculumCourses.length > 0) {
                        const startYear = values.py ? Number(values.py) : getEntryYear(STUDENT_ID ?? student.id);
                        const currentYear = new Date().getFullYear();
                        return fetchCourseDetailsBySearching(
                            c,
                            STUDENT_ID ?? student.id,
                            yt,
                            startYear,
                            currentYear,
                            COOKIE!
                        ).catch(() => c);
                    } else {
                        return fetchCourseDetails(c, STUDENT_ID ?? student.id, yt, COOKIE!).catch(() => c);
                    }
                })
            );
            enriched.push(...results);

            if (i + BATCH_SIZE < validCourses.length) {
                await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
            }
        }

        sem.courses = enriched.filter((c) => {
            const hasData =
                c.lecturer ||
                c.assessments?.length ||
                c.finalScore ||
                (c.grade && c.grade !== "IP" && c.grade !== "");
            if (!hasData) console.log(`   [SKIP] No data: ${c.code}`);
            return hasData;
        });
    }

    // ─── Output ─────────────────────────────────────────────────────────────────

    const packed = semestersToProcess.filter((s) => s.courses.length > 0);
    const sorted = sortGrades(packed, "grade", "desc");

    console.log("\n📊 Results:");
    for (const sem of sorted) {
        console.log(`\n📚 ${sem.semester}`);
        for (const course of sem.courses) {
            const curr = curriculumCourses.find(
                (c) => c.code === course.code.replace(/^\./, "").trim().toUpperCase()
            );

            console.log(`\n  ${course.code} — ${course.name}`);
            if (curr) console.log(`  Curriculum Semester: ${curr.semester}`);
            console.log(
                `  Grade: ${course.grade || "N/A"} | Credits: ${course.credit}${course.finalScore ? ` | Score: ${course.finalScore}` : ""
                }`
            );
            if (course.lecturer) console.log(`  Lecturer: ${course.lecturer}`);
            if (course.attendance) console.log(`  Attendance: ${course.attendance}`);
            if (course.assessments?.length) console.table(course.assessments);
        }
    }
} catch (error: any) {
    console.error("\n❌ Fatal error:", error.message);
    process.exit(1);
}