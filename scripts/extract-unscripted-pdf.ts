import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const PDF_PATH = path.join(process.cwd(), 'data/documents/raw/master/buffett/annual-meeting-unscripted.pdf');
const OUTPUT_DIR = path.join(process.cwd(), 'data/annual_meeting/raw_en');

async function extract() {
    console.log(`Loading PDF from ${PDF_PATH}...`);
    const dataBuffer = fs.readFileSync(PDF_PATH);

    const data = await pdf(dataBuffer);
    
    // Clean up: normalize whitespace and remove weird tab artifacts
    // pdf-parse sometimes leaves spaces between letters like "T H E" or "stock"
    // But based on the 'head' output, it seems mostly OK but has some weird spacing.
    // Let's at least normalize newlines and multiple spaces.
    const text = data.text.replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ');

    console.log(`Extracted ${text.length} characters.`);

    // Pattern for meeting header: YYYY MEETING (HH:MM:SS)
    const meetingPattern = /\n\s*((?:19|20)\d{2})\s+MEETING\s+\(\d{2}:\d{2}:\d{2}\)\s*\n/gi;
    
    let match;
    const matches: { year: string, header: string, index: number }[] = [];
    
    const re = new RegExp(meetingPattern);
    while ((match = re.exec(text)) !== null) {
        matches.push({ year: match[1], header: match[0].trim(), index: match.index });
    }

    console.log(`Found ${matches.length} potential meeting headers.`);

    const yearGroups: Record<string, string[]> = {};
    let validCount = 0;

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i < matches.length - 1 ? matches[i+1].index : text.length;
        const content = text.slice(start, end).trim();

        // VALIDATION: Must contain WB/CM dialog
        const hasDialog = /\b(WB|CM|WARREN BUFFETT|CHARLIE MUNGER)\s*[:：]/i.test(content);
        if (!hasDialog) continue;

        validCount++;
        const year = matches[i].year;
        if (!yearGroups[year]) yearGroups[year] = [];

        // Try to find topic: often a capitalized line after the dialog ends or before the next header
        // In this PDF, it seems the topic header might be BEFORE the meeting header in the TOC, 
        // but in the body it appears as a footer-like line or header.
        // Let's keep it simple: just the content for now, we can refine topics during translation if needed.
        
        let cleanContent = content.replace(matches[i].header, "").trim();
        
        // Remove trailing lines that look like topics (all caps, short)
        const lines = cleanContent.split('\n');
        let topic = "";
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine.length > 3 && lastLine.length < 50 && lastLine === lastLine.toUpperCase() && !lastLine.includes(':')) {
                topic = lastLine;
                cleanContent = lines.slice(0, -1).join('\n').trim();
            }
        }

        let formattedSnippet = `### ${matches[i].header}\n\n`;
        if (topic) formattedSnippet = `## ${topic}\n\n` + formattedSnippet;
        formattedSnippet += cleanContent + "\n";

        yearGroups[year].push(formattedSnippet);
    }

    // Clean output directory
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.readdirSync(OUTPUT_DIR).forEach(file => {
            fs.unlinkSync(path.join(OUTPUT_DIR, file));
        });
    } else {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    for (const year in yearGroups) {
        const fileName = `${year}_Annual_Meeting.md`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        const fileContent = `# ${year} Berkshire Hathaway Annual Meeting (Unscripted)\n\n` + yearGroups[year].join('\n---\n\n');
        fs.writeFileSync(filePath, fileContent);
        console.log(`Wrote ${fileName} (${yearGroups[year].length} snippets)`);
    }

    console.log(`Total valid snippets extracted: ${validCount}`);
}

extract().catch(console.error);
