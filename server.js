const ytdl = require("ytdl-core");
const fs = require("fs");
const { readdirSync, unlinkSync, existsSync, mkdirSync } = fs;
const { promisify } = require("util");
const path = require("path");
const fastifyCron = require("fastify-cron");

// Require the framework and instantiate it
const fastify = require("fastify")({
  logger: {
    prettyPrint: {
      translateTime: true,
      ignore: "pid,hostname,reqId,responseTime,req,res",
      messageFormat: "{msg} [id={reqId} {req.method} {req.url}]",
    },
  },
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
        const dir = "./downloads";
        readdirSync(dir).forEach((f) => unlinkSync(`${dir}/${f}`));
      },
    },
  ],
});

//create downloads dir if it does not exist
const downloadsDir = "./downloads";
if (!existsSync(downloadsDir)) {
  mkdirSync(downloadsDir);
}

fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "/downloads"),
});

fastify.register(require("point-of-view"), {
  engine: {
    ejs: require("ejs"),
  },
});

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
    .pipe(fs.createWriteStream(`./downloads/${videoID}.${ext}`))
    .on("finish", async function () {
      return reply.send({ id: videoID, title, ext, isTooLong });
    });
};

const pDownloadAndSend = promisify(downloadContentAndSendLink);

// Declare a route
fastify.get("/", (req, reply) => {
  reply.view("/templates/index.ejs");
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
  setTimeout(() => {
    const dir = "./downloads";

    readdirSync(dir).forEach((f) =>
      f === `${id}.${extension}` ? unlinkSync(`${dir}/${f}`) : null
    );
  }, 60000);

  return reply.download(`/${id}.${extension}`, `${title}.${extension}`);
});

// Run the server!
const start = async () => {
  try {
    await fastify.listen(3000);
    fastify.cron.startAllJobs(); //start cron
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
