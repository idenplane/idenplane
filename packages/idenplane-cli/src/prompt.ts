import { createInterface } from 'readline';

/**
 * Print `question` and read a line of trimmed input from stdin.
 *
 * @throws {Error} If stdin closes (EOF) before an answer is entered.
 */
export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    const onEnd = () => {
      rl.close();
      reject(new Error('stdin closed unexpectedly (EOF)'));
    };
    process.stdin.once('end', onEnd);

    rl.question(question, (answer) => {
      process.stdin.removeListener('end', onEnd);
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Print `question` and read a password from stdin without echoing it —
 * each typed character prints as `*`, backspace erases the last `*`.
 *
 * @throws {Error} If Ctrl+C is pressed, or if stdin closes (EOF) before input is submitted.
 */
export async function askPassword(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let password = '';
    const stdin = process.stdin;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    const onData = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        if (stdin.setRawMode) stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        console.log();
        resolve(password);
      } else if (ch === '\u007F' || ch === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (ch === '\u0003') {
        // Ctrl+C — reject the promise so the caller can handle it cleanly
        if (stdin.setRawMode) stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        console.log();
        reject(new Error('Interrupted'));
      } else {
        password += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);

    const onEnd = () => {
      if (stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      reject(new Error('stdin closed unexpectedly (EOF)'));
    };
    stdin.on('end', onEnd);
  });
}

/** Ask a yes/no `question`, defaulting to "no" for any answer other than `y`/`yes` (case-insensitive). */
export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/N) `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Print `question` followed by a numbered list of `options`, then prompt for
 * a 1-based choice and return the selected option.
 *
 * @throws {Error} If the entered number is out of range (`1`..`options.length`).
 */
export async function select(question: string, options: string[]): Promise<string> {
  console.log(question);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  const answer = await ask('Choice: ');
  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= options.length) {
    throw new Error('Invalid selection');
  }
  return options[idx];
}
