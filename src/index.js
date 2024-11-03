import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono();

app.use("*", (c, next) => {
  try {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    if (c.req.method === "OPTIONS") {
      headers.set('Access-Control-Max-Age', '86400');
      return new Response(null, { status: 204, headers });
    }

    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    return next();
  } catch (err) {
    console.error('Error in CORS middleware:', err);
    return new Response('Internal server error', { status: 500 });
  }
});

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
    
    await c.env.wordGameData.put(uid, data[0]);

    return c.json({ uid });
  } catch (err) {
    console.error('Error fetching word from primary API:', err);
    try {
      const response = await fetch("https://random-word-api.vercel.app/api?words=1&length=5");
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data = await response.json();

      await c.env.wordGameData.put(uid, data[0]);

      console.log(wordByUser[uid]);
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
  }
  
  return c.json({ solution });
});

export default app;