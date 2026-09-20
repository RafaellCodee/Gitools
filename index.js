import { Octokit } from '@octokit/rest';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

dotenv.config();

const IGNORE_PATTERNS = [
  'node_modules/',
  '.git/',
  '.DS_Store',
  'Thumbs.db',
  '__MACOSX/'
];

function shouldIgnore(entryPath) {
  return IGNORE_PATTERNS.some(pattern => entryPath.includes(pattern));
}

// Deteksi apakah ZIP dibungkus satu folder utama
function detectCommonPrefix(entries) {
  if (entries.length === 0) return '';
  const firstPath = entries[0].entryName.replace(/\\/g, '/');
  const firstPart = firstPath.split('/')[0];

  if (!firstPart || firstPath.indexOf('/') === -1) {
    return '';
  }

  const prefixCandidate = `${firstPart}/`;
  const allMatch = entries.every(entry => {
    const p = entry.entryName.replace(/\\/g, '/');
    return p.startsWith(prefixCandidate);
  });

  return allMatch ? prefixCandidate : '';
}

async function run() {
  console.log(chalk.bold.cyan('\n======================================='));
  console.log(chalk.bold.cyan('   GitHub ZIP Uploader (Git Tree API)  '));
  console.log(chalk.bold.cyan('=======================================\n'));

  const token = process.env.GITHUB_TOKEN;
  if (!token || token.trim() === '' || token.includes('yourPersonalAccessTokenHere')) {
    console.error(chalk.red('Error: GITHUB_TOKEN belum diatur pada file .env!'));
    console.log(chalk.yellow('Silakan duplikat .env.example menjadi .env dan isi dengan token GitHub Anda.'));
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  let user;
  try {
    const userRes = await octokit.rest.users.getAuthenticated();
    user = userRes.data;
    console.log(chalk.green(`Terhubung sebagai: @${user.login} (${user.name || 'No Display Name'})\n`));
  } catch (err) {
    console.error(chalk.red(`Gagal terhubung ke GitHub: ${err.message}`));
    console.log(chalk.yellow('Pastikan token GitHub Anda valid dan memiliki izin (scope: repo).'));
    process.exit(1);
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'zipPath',
      message: 'Masukkan path file ZIP lokal:',
      validate: (input) => {
        const clean = input.trim().replace(/^['"]|['"]$/g, '');
        if (!clean) return 'Path tidak boleh kosong.';
        if (!fs.existsSync(clean)) return `File '${clean}' tidak ditemukan!`;
        if (path.extname(clean).toLowerCase() !== '.zip') return 'File harus berekstensi .zip!';
        return true;
      },
      filter: (input) => input.trim().replace(/^['"]|['"]$/g, '')
    },
    {
      type: 'list',
      name: 'targetMode',
      message: 'Pilih target repositori:',
      choices: [
        { name: 'Buat repository baru', value: 'new' },
        { name: 'Gunakan repository yang sudah ada', value: 'existing' }
      ]
    },
    {
      type: 'input',
      name: 'repoName',
      message: 'Nama repository:',
      validate: (input) => input.trim().length > 0 ? true : 'Nama repo tidak boleh kosong.'
    },
    {
      type: 'confirm',
      name: 'isPrivate',
      message: 'Jadikan repository private?',
      default: false,
      when: (ans) => ans.targetMode === 'new'
    },
    {
      type: 'input',
      name: 'branch',
      message: 'Target branch:',
      default: 'main'
    },
    {
      type: 'input',
      name: 'commitMessage',
      message: 'Pesan commit:',
      default: 'Upload project via ZIP Extractor Tool'
    }
  ]);

  const owner = user.login;
  const repo = answers.repoName.trim();
  const branch = answers.branch.trim();

  // 1. Ekstrak ZIP
  console.log(chalk.blue(`\n[1/5] Membaca & memvalidasi file ZIP: ${answers.zipPath}...`));
  let zip;
  try {
    zip = new AdmZip(answers.zipPath);
  } catch (err) {
    console.error(chalk.red(`Gagal membuka file ZIP: ${err.message}`));
    process.exit(1);
  }

  const allEntries = zip.getEntries();
  const fileEntries = allEntries.filter(entry => !entry.isDirectory && !shouldIgnore(entry.entryName));

  if (fileEntries.length === 0) {
    console.log(chalk.red('Tidak ada file valid yang ditemukan di dalam ZIP.'));
    process.exit(1);
  }

  // Cek apakah ada wrapping folder tunggal
  const commonPrefix = detectCommonPrefix(fileEntries);
  if (commonPrefix) {
    console.log(chalk.gray(`* Mendeteksi folder pembungkus '${commonPrefix}', jalur file akan di-flatten ke root.`));
  }
  console.log(chalk.green(`Ditemukan ${fileEntries.length} file valid untuk diunggah.`));

  // 2. Buat Repo jika mode new
  if (answers.targetMode === 'new') {
    console.log(chalk.blue(`\n[2/5] Membuat repository baru: ${repo}...`));
    try {
      await octokit.rest.repos.createForAuthenticatedUser({
        name: repo,
        private: answers.isPrivate,
        auto_init: true
      });
      console.log(chalk.green(`Repository berhasil dibuat.`));
      // Beri jeda sejenak agar backend GitHub menyelesaikan inisialisasi default branch
      await new Promise(res => setTimeout(res, 2500));
    } catch (err) {
      if (err.status === 422) {
        console.log(chalk.yellow(`Repository '${repo}' sudah ada di akun Anda. Melanjutkan push...`));
      } else {
        throw new Error(`Gagal membuat repo: ${err.message}`);
      }
    }
  } else {
    console.log(chalk.blue(`\n[2/5] Memeriksa repositori target: ${repo}...`));
  }

  // 3. Upload File Blobs
  console.log(chalk.blue(`\n[3/5] Mengunggah file blobs ke GitHub API...`));
  const treeItems = [];
  let index = 0;

  for (const entry of fileEntries) {
    index++;
    let targetPath = entry.entryName.replace(/\\/g, '/');
    if (commonPrefix && targetPath.startsWith(commonPrefix)) {
      targetPath = targetPath.slice(commonPrefix.length);
    }

    process.stdout.write(`\r  [${index}/${fileEntries.length}] Mengunggah: ${targetPath.padEnd(45).substring(0, 45)}`);

    const dataBuffer = entry.getData();
    // GitHub createBlob menerima base64 untuk semua jenis file secara aman
    const base64Content = dataBuffer.toString('base64');

    const { data: blob } = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: base64Content,
      encoding: 'base64'
    });

    treeItems.push({
      path: targetPath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }
  console.log(chalk.green(`\n  Semua blob berhasil diunggah.`));

  // 4. Ambil Head Commit Branch & Buat Tree
  console.log(chalk.blue(`\n[4/5] Mengambil referensi branch dan merakit Git Tree...`));
  let parentCommitSha = null;
  let baseTreeSha = null;

  try {
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });
    parentCommitSha = refData.object.sha;

    const { data: parentCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: parentCommitSha
    });
    baseTreeSha = parentCommit.tree.sha;
  } catch (err) {
    console.log(chalk.yellow(`  Branch '${branch}' belum memiliki commit awal atau belum terbentuk.`));
  }

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha || undefined,
    tree: treeItems
  });

  // 5. Buat Commit & Perbarui Ref
  console.log(chalk.blue(`\n[5/5] Membuat commit dan sinkronisasi branch...`));
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: answers.commitMessage,
    tree: newTree.sha,
    parents: parentCommitSha ? [parentCommitSha] : []
  });

  try {
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
      force: true
    });
  } catch (err) {
    // Jika branch baru pertama kali dibuat
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: newCommit.sha
    });
  }

  console.log(chalk.bold.green('\n======================================='));
  console.log(chalk.bold.green('   BERHASIL! PROSES UPLOAD SELESAI     '));
  console.log(chalk.bold.green('======================================='));
  console.log(chalk.cyan(`\nRepo URL   : https://github.com/${owner}/${repo}`));
  console.log(chalk.cyan(`Branch     : https://github.com/${owner}/${repo}/tree/${branch}`));
  console.log(chalk.cyan(`Commit SHA : ${newCommit.sha}\n`));
}

run().catch(err => {
  console.error(chalk.red(`\n[ERROR FATAL]: ${err.message}`));
  if (err.response && err.response.data) {
    console.error(chalk.gray(JSON.stringify(err.response.data, null, 2)));
  }
  process.exit(1);
});
