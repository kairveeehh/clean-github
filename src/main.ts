require('dotenv').config();
const axios = require('axios');
const open = require('open');   // version 8 or lower
const chalk = require('chalk');
const inquirer = require('inquirer');

const CLIENT_ID =  'Ov23liO4GXZ8vNz0yHDm';


let accessToken = '';

async function githubAuth(): Promise<void> {
  console.log(chalk.cyan('🔐 Starting GitHub authentication...'));

  const deviceCodeRes = await axios.post(
    'https://github.com/login/device/code',
    new URLSearchParams({
      client_id: CLIENT_ID,
      scope: 'repo delete_repo',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }
  );

  const { user_code, device_code, verification_uri, expires_in, interval } = deviceCodeRes.data;

  console.log(`\n🔗 Please visit ${chalk.yellow(verification_uri)} and enter code: ${chalk.green.bold(user_code)}\n`);
  await open(verification_uri);

  let authenticated = false;
  const maxTries = expires_in / interval;
  let tries = 0;

  while (!authenticated && tries < maxTries) {
    await new Promise((res) => setTimeout(res, interval * 1000));
    tries++;

    try {
      const tokenRes = await axios.post(
        'https://github.com/login/oauth/access_token',
        new URLSearchParams({
          client_id: CLIENT_ID,
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }
      );

      if (tokenRes.data.access_token) {
        accessToken = tokenRes.data.access_token;
        authenticated = true;
        console.log(chalk.green('\n✅ Authenticated successfully!\n'));
      }
    } catch (err: any) {
      if (err.response?.data?.error !== 'authorization_pending') {
        console.error(chalk.red('❌ Auth failed:'), err.response?.data?.error_description || err.message);
        process.exit(1);
      }
    }
  }

  if (!authenticated) {
    console.error(chalk.red('❌ Timed out waiting for authentication.'));
    process.exit(1);
  }
}

async function getUserRepos(): Promise<any[]> {
  const res = await axios.get('https://api.github.com/user/repos?per_page=100', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });

  return res.data;
}

async function deleteRepos(repos: { name: string; full_name: string }[]) {
  const confirm = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDeleteAll',
      message: `⚠️ Are you sure you want to delete all ${repos.length} selected repositories?`,
      default: false,
    },
  ]);

  if (!confirm.confirmDeleteAll) {
    console.log(chalk.yellow('❌ Deletion cancelled.'));
    return;
  }

  for (const repo of repos) {
    try {
      await axios.delete(`https://api.github.com/repos/${repo.full_name}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      });
      console.log(chalk.green(`🗑️ Deleted ${repo.full_name}`));
    } catch (err: any) {
      console.error(chalk.red(`❌ Failed to delete ${repo.full_name}:`), err.response?.data?.message || err.message);
    }
  }
}


export async function main() {
  console.log(chalk.magentaBright.bold('\n✨ GitHub Repo Cleaner CLI ✨\n'));

  await githubAuth();

  const repos = await getUserRepos();
  if (repos.length === 0) {
    console.log(chalk.yellow('No repositories found.'));
    return;
  }

  const choices = repos.map((repo: any) => ({
    name: `${repo.full_name} (${repo.private ? 'private' : 'public'})`,
    value: { name: repo.name, full_name: repo.full_name },
  }));

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'reposToDelete',
      message: 'Select the repositories you want to delete:',
      choices,
      pageSize: 15,
    },
  ]);

  if (!answers.reposToDelete.length) {
    console.log(chalk.yellow('No repositories selected.'));
    return;
  }

  await deleteRepos(answers.reposToDelete);
}

main().catch((err) => {
  console.error(chalk.red('❌ Unexpected error:'), err);
});
