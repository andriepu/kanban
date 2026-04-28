import { execFileSync } from "node:child_process";

interface PsRow {
	pid: number;
	ppid: number;
	args: string;
}

function readProcessTable(): PsRow[] {
	if (process.platform === "win32") {
		return [];
	}
	let output: string;
	try {
		output = execFileSync("ps", ["-axo", "pid=,ppid=,args="], {
			encoding: "utf8",
			timeout: 1000,
			maxBuffer: 8 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return [];
	}
	const rows: PsRow[] = [];
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
		if (!match) continue;
		const pid = Number.parseInt(match[1] ?? "", 10);
		const ppid = Number.parseInt(match[2] ?? "", 10);
		if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
		rows.push({ pid, ppid, args: match[3] ?? "" });
	}
	return rows;
}

export function getDescendantCommandLines(rootPid: number): string[] {
	if (!Number.isFinite(rootPid) || rootPid <= 0) return [];
	const rows = readProcessTable();
	if (rows.length === 0) return [];
	const childrenByPpid = new Map<number, PsRow[]>();
	for (const row of rows) {
		const list = childrenByPpid.get(row.ppid);
		if (list) {
			list.push(row);
		} else {
			childrenByPpid.set(row.ppid, [row]);
		}
	}
	const result: string[] = [];
	const seen = new Set<number>();
	const queue: number[] = [rootPid];
	while (queue.length > 0) {
		const pid = queue.shift();
		if (pid === undefined || seen.has(pid)) continue;
		seen.add(pid);
		const children = childrenByPpid.get(pid);
		if (!children) continue;
		for (const child of children) {
			result.push(child.args);
			queue.push(child.pid);
		}
	}
	return result;
}
