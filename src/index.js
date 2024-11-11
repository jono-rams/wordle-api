import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/serve-static';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono();
app.use(logger());

async function clearExpiredKeys(c) {
  try {
    const list = await c.env.wordGameData.list();

    const expiryDuration = 60 * 60 * 1000; // 1 hour in milliseconds
    const now = Date.now();

    for (const key of list.keys) {
      const metadata = await c.env.wordGameData.getWithMetadata(key.name);
      const createdAt = metadata.metadata?.created_at || 0;

      if (now - createdAt > expiryDuration) {
        await c.env.wordGameData.delete(key.name);
        console.log(`Deleted expired key: ${key.name} created ${(now-createdAt)/1000/60/60} hours ago`);
      }
    }
  } catch (err) {
    console.error('Error clearing expired keys:', err);
  }
}

app.use('*', cors({
  origin: '*', // Allow all origins
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type']
}));

app.get('/api/new-word', async (c) => {
  const uid = uuidv4();
  try {
    // Promise that resolves after a timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Primary API timeout'));
      }, 250);
    });
    // Race between the API call and the timeout
    const response = await Promise.race([
      fetch("https://random-word-api.herokuapp.com/word?length=5"),
      timeoutPromise,
    ]);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    
    if (c.env.wordGameData) { 
      await c.env.wordGameData.put(uid, data[0]);
    } else {
      console.error('Error: wordGameData is undefined');
      return c.status(500).json({ error: 'Failed to store word in KV' });
    }

    return c.json({ uid });
  } catch (err) {
    console.error('Error fetching word from primary API:', err);
    try {
      const response = await fetch("https://random-word-api.vercel.app/api?words=1&length=5");
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      if (c.env.wordGameData) { 
        await c.env.wordGameData.put(uid, data[0]);
      } else {
        console.error('Error: wordGameData is undefined');
        return c.status(500).json({ error: 'Failed to store word in KV' });
      }

      return c.json({ uid });
    } catch (err) {
      console.error('Error fetching word from fallback API:', err);
      // setError(true); // Handle error appropriately in Worker context
      return c.status(500).json({ error: 'Failed to fetch word' });
    }
  }
});

app.post('/api/guess', async (c) => {
  const { uid, guess } = await c.req.json(); // Parse JSON body
  
  const secretWord = await c.env.wordGameData.get(uid);

  if (!secretWord) {
    return c.status(400).json({ error: 'Invalid session id' });
  }
   // Input validation
   if (typeof guess !== 'string' || guess.length !== 5 || !/^[a-z]+$/.test(guess)) {
    return c.status(400).json({ error: 'Invalid guess' });
  }

  const result = compareWords([...secretWord], [...guess]);
  return c.json({ result });
});

// Function to compare words (unchanged)
function compareWords(secretWord, guess) {
  let result = guess.map((letter) => { return { key: letter, color: 'grey' }; });
  // find any green letters
  result.forEach((letter, index) => {
    if (secretWord[index] === letter.key) {
      result[index].color = 'green';
      secretWord[index] = null;
    }
  });
  // find any yellow letters
  result.forEach((letter, index) => {
    if (secretWord.includes(letter.key) && letter.color !== 'green') {
      result[index].color = 'yellow';
      secretWord[secretWord.indexOf(letter.key)] = null;
    }
  });
  return result;
}

app.get('/api/solution', async (c) => {
  const uid = c.req.query('uid');
  
  const solution = await c.env.wordGameData.get(uid);

  if (solution) {
    await c.env.wordGameData.delete(uid);
    return c.json({ solution });
  } else {
    return c.status(400).json({ error: 'Invalid session id' });
  }
});

app.get('/api/cleanup', async (c) => {
  await clearExpiredKeys(c);
  return c.text('Cleanup initiated');
});

app.get('*', async (c, next) => {
  try {
    await serveStatic({ path: './index.html' });
  } catch (err) {
    console.error('Error serving static file:', err);
    return c.status(500).text('Internal Server Error');
  }
})

export default app;