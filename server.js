const ytdl = require("ytdl-core");
const fs = require("fs");
const { readdirSync, unlinkSync, existsSync, mkdirSync } = fs;
const fastifyCron = require("fastify-cron");


const { promisify } = require("util");

const downloadContentAndSendLink = async (srcUrl, ext, reply, opts = {}) => {
  const videoID = ytdl.getVideoID(srcUrl);
  let info = await ytdl.getInfo(videoID);
  const { videoDetails } = info;
  const { title } = videoDetails;

  let isTooLong = false;
  if (videoDetails.lengthSeconds > 7200) {
    isTooLong = true;
    return reply.send({ id: videoID, title, ext, isTooLong });
  }

  ytdl(srcUrl, opts)
    .pipe(fs.createWriteStream(`./templates/downloads/${videoID}.${ext}`))
    .on("finish", async function () {
      return reply.send({ id: videoID, title, ext, isTooLong });
    });
};

const pDownloadAndSend = promisify(downloadContentAndSendLink);



//logging config
const envToLogger = {
  development: {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
  production: true,
  test: false,
};

const environment = "development";


// Require the framework and instantiate it
const fastify = require("fastify")({
  logger: envToLogger[environment]
});

//create downloads dir if it does not exist
const downloadsDir = "./templates/downloads";
if (!existsSync(downloadsDir)) {
  mkdirSync(downloadsDir);
}


//register plugins
fastify.register(require("@fastify/static"), {
  root: require("path").join(__dirname, "templates"),
});

//set up cron
fastify.register(fastifyCron, {
  jobs: [
    {
      // Only these two properties are required,
      // the rest is from the node-cron API:
      // https://github.com/kelektiv/node-cron#api
      cronTime: "0 0 * * *", // Everyday at midnight UTC

      // Note: the callbacks (onTick & onComplete) take the server
      // as an argument, as opposed to nothing in the node-cron API:
      onTick: async () => {
        const dir = "./templates/downloads";
        readdirSync(dir).forEach((f) => unlinkSync(`${dir}/${f}`));
      },
    },
  ],
});



// Declare a route
fastify.get("/", (req, reply) => {
  reply.sendFile("index.html");
});

fastify.post("/audio", async (request, reply) => {
  const srcUrl = request.body.url;

  await pDownloadAndSend(srcUrl, "mp3", reply, {
    filter: "audioonly",
    format: "mp3",
  });
});

fastify.post("/video", async (req, reply) => {
  const srcUrl = req.body.url;
  await pDownloadAndSend(srcUrl, "mp4", reply);
});


fastify.get("/download/:id", async (request, reply) => {
  const { id } = request.params;
  let info = await ytdl.getInfo(id);
  const { videoDetails } = info;
  const { title } = videoDetails;
  const { extension } = request.query;


  //delete downloaded file after 1 min
  setTimeout(async () => {
    const dir = "./templates/downloads";
    readdirSync(dir).forEach((f) =>
      f === `${id}.${extension}` ? unlinkSync(`${dir}/${f}`) : null
    );
  }, 60000);

  return reply.download(
    `./downloads/${id}.${extension}`,
    `${title}.${extension}`
  );
});




// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: 3000 }, () => {
      fastify.cron.startAllJobs();
    });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
