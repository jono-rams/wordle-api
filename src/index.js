import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/serve-static';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono();
app.use(logger());

app.use(
	'*',
	cors({
		origin: '*', // Allow all origins
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type'],
	})
);

app.get('/api/new-word', async (c) => {
	// Generate new unique session id
	const session_id = uuidv4();

	try {
		// Promise that resolves after a timeout
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error('Primary API timeout'));
			}, 250);
		});

		// Race between the API call and the timeout
		const response = await Promise.race([fetch('https://random-word-api.herokuapp.com/word?length=5'), timeoutPromise]);

		// Check if response is okay
		if (!response.ok) {
			throw new Error('Network response was not ok');
		}

		// Parse JSON response from API and store the word in KV database with session id as key
		const data = await response.json();

		if (c.env.wordGameData) {
			await c.env.wordGameData.put(session_id, data[0], { expirationTtl: 900 }); // Write word to KV database with session id as key
		} else {
			console.error('Error: wordGameData is undefined');

			return c.json({ error: 'Error in database, cannot store game session' }, 500);
		}

		return c.json({ session_id, "uid": session_id }, 200);
	} catch (err) {
		console.error('Error fetching word from primary API:', err);
		try {
			const response = await fetch('https://random-word-api.vercel.app/api?words=1&length=5');

			// Check if response is okay
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}

			// Parse JSON response from API and store the word in KV database with session id as key
			const data = await response.json();

			if (c.env.wordGameData) {
				await c.env.wordGameData.put(session_id, data[0], { expirationTtl: 900 }); // Write word to KV database with session id as key
			} else {
				console.error('Error: wordGameData is undefined');

				return c.json({ error: 'Error in database, cannot store game session' }, 500);
			}

			return c.json({ session_id, "uid": session_id }, 200);
		} catch (err) {
			console.error('Error fetching word from fallback API:', err);

			return c.json({ error: 'Failed to fetch word' }, 500);
		}
	}
});

app.post('/api/guess', async (c) => {
	let { uid, session_id, guess } = await c.req.json(); // Parse JSON body

	// If uid is provided, use it as session_id for backward compatibility
	if (uid && !session_id) {
		session_id = uid;
	}

	// Error handling: If no session id (or uid) is provided, return an error response
	if (!session_id) {
		return c.json({ error: 'Missing session_id (or uid for older clients)' }, 400);
	}

	if (!guess) {
    return c.json({ error: 'Missing guess' }, 400);
  }

	const secretWord = await c.env.wordGameData.get(session_id); // Retrieve the secret word for the given session id

	// Error handling: If no secret word is found for the session id, return an error response
	if (!secretWord) {
		return c.status(400).json({ error: 'Invalid session id' });
	}

	// Input validation: Check if the guess is valid
	if (typeof guess !== 'string') {
		return c.status(400).json({ error: 'Invalid guess: Guess must be a string.' });
	} else if (guess.length !== 5) {
		return c.status(400).json({ error: 'Invalid guess: Guess must be 5 letters long.' });
	} else if (!/^[a-z]+$/.test(guess)) {
		return c.status(400).json({ error: 'Invalid guess: Guess must contain only lowercase letters.' });
	}

	const result = compareWords([...secretWord], [...guess]); // Compare the guess with the secret word
	return c.json({ result }); // Return the result of the comparison
});

// Function to compare words (unchanged)
function compareWords(secretWord, guess) {
	let result = guess.map((letter) => {
		return { key: letter, color: 'grey' };
	});
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
	try {
		let session_id = c.req.query('session_id'); // Retrieve session_id from the query parameters

		// Backward compatibility: If uid is provided but session_id is not, use uid as session_id
    if (c.req.query('uid') && !session_id) {
      session_id = c.req.query('uid');
    }

		if (!session_id) {
      return c.json({ error: 'Missing session_id (or uid for older clients)' }, 400);
    }

		// Retrieve the solution for the given session id
		const solution = await c.env.wordGameData.get(session_id);

		if (solution) {
			await c.env.wordGameData.delete(session_id); // Delete the session data after retrieving the solution
			return c.json({ solution }); // Return the solution
		} else {
			return c.status(404).json({ error: 'Invalid session id' }); // Return an error if no solution is found for the session id
		}
	} catch (err) {
		console.error('Error fetching solution:', err); // Log any errors encountered while fetching the solution
		return c.status(500).json({ error: 'Failed to fetch solution' }); // Return a generic error response to the client
	}
});

app.get('*', async (c, next) => {
	try {
		await serveStatic({ path: './index.html' });
	} catch (err) {
		console.error('Error serving static file:', err);
		return c.status(500).text('Internal Server Error');
	}
});

export default app;
