const db = require("../../models/db.config");
const User = db.users;
const Course = db.courses;
const Wishlist = db.wishlists;
const Lecture = db.lectures;
const Review = db.reviews;
const Notification = db.notifications;
const Learning = db.learnings;
const uuid = require("uuid");
const uuidv1 = uuid.v1;
const fs = require("fs");
const { Op, Sequelize } = require("sequelize");
const { format } = require("util");
const upload = require("../../services/googleStorage.service");
const sharp = require("sharp");

exports.getMe = async (req, res) => {
  let wishlistId = [];
  const ids = await Wishlist.findAll({
    where: { userId: req.user._id },
    raw: true,
  });
  ids.map((id) => {
    wishlistId.push(id.courseId);
  });
  const user = await User.findOne({
    where: { _id: req.user._id },
    include: {
      model: Course,
      as: "mylearningcourses",
      attributes: ["_id"],
    }
  });
  let mylearningcourses = []
user.dataValues.mylearningcourses.map(u => {
  mylearningcourses.push(u._id)
})
  const notis = await Notification.findAll({
    where: { receiverId: req.user._id },
    include: { model: User, as: "from", attributes: ["photo", "_id"] },

    limit: 4,
  });
  notis.map(noti => {
    noti.from.photo = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${noti.from.photo}/200_200.png`
  })
  user.dataValues.notis = notis;
  user.dataValues.photo = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${user.photo}/200_200.png`;
  user.dataValues.mywishlist = wishlistId;
  res.send({
    user: {...user.dataValues, mylearningcourses:mylearningcourses},
    code: 200,
    message: "success",
  });
};

exports.getCourseByMe = async (req, res) => {
  const user = await User.findOne({
    where: { _id: req.user._id },
    include: {
      model: Course,
      as: "mylearningcourses",
      attributes: ["_id"],
    },
  });
  let mylearningcourses = [];
  user.mylearningcourses.map((mycourse) => {
    mylearningcourses.push(mycourse._id);
  });
  let condition = { _id: { [Op.in]: mylearningcourses }, public: true };
  if (req.body.level) condition.level = req.body.level;
  if (req.body.free)
    condition.cost = req.body.free == "true" ? 0 : { [Op.gt]: 0 };
  if (req.body.name) condition.name = { [Op.like]: "%" + req.body.name + "%" };
  let sort;
  if (!req.body.sort) sort = ["name", "ASC"];
  else {
    switch (parseInt(req.body.sort)) {
      case 1:
        sort = ["name", "ASC"];
        break;
      case 2:
        sort = ["name", "DESC"];
        break;
    }
  }
  const datas = await Course.findAll({
    where: condition,
    include: {
      model: User,
      as: "lecturer",
      attributes: ["_id", "username", "photo"],
    },
    attributes: [
      "_id",
      "name",
      "coverphoto",
      "cost",
      "numberofstudent",
      "numberofreviews",
      "star",
      "description",
    ],
    limit: 8,
    offset: (req.body.page || 1) * 8 - 8,
  });
  datas.map((data) => {
    data.coverphoto = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}/240_135.png`;
  });
  res.json({
    code: 200,
    courses: datas,
  });
};

exports.getAllMyCourses = async (req, res) => {
  const datas = await Course.findAll({
    where: { userId: req.user._id },
  });
  datas.map((data) => {
    data.coverphoto = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}/130_73.png`;
  });
  res.end(JSON.stringify(datas));
};

exports.createCourse = async (req, res) => {
  const newCourse = Course.build({
    name: req.body.coursename,
    userId: req.user._id,
    genreId: null,
    subGenreId: null,
  });
  await newCourse.save();
  res.send({ code: 200, message: "success", course: newCourse });
};

exports.takeACourses = async (req, res) => {
  const courseIdfound = await Learning.findAll({
    where: { userId: req.user._id },
  });
  const result = courseIdfound.filter((element) => {
    return (element.dataValues.courseId = req.body.courseid);
  });
  if (!result) {
    return res.send({ code: 404, message: "error" });
  } else {
    await Course.findOne({
      where: { _id: req.body.courseid }
    })
      .then(async (course) => {
        if (!course) return res.send({ code: 404, message: "error" });
        if (req.user.creditbalance < course.cost) {
          return res.send({
            code: 404,
            message: "The credit balance is not enough to make payments",
          });
        }
        await Learning.create({ userId: req.user._id, courseId: req.body.courseid })
        .then((u) => console.log(u))
        .catch((err) => console.log(err));
        User.increment(
          { creditbalance: -course.cost },
          { where: { _id: req.user._id } }
        );
        fs.readFile("config.json", async (err, data) => {
          if (err) {
            console.log(err);
          }
          let config = JSON.parse(data.toString());
          User.increment({
            creditbalance:
              (course.cost * (100.0 - parseFloat(config.PROFIT_RATIO))) / 100.0,
          });
          config.TOTAL_PROFIT =
            parseFloat(config.TOTAL_PROFIT) +
            (course.cost * parseFloat(config.PROFIT_RATIO)) / 100.0;
          fs.writeFile("config.json", JSON.stringify(config), (err) => {});
          await Notification.create({
            senderId: req.user._id,
            receiverId: course.lecturer._id,
            title: "Conratulation",
            message:
              user.username + " has enrolled in " + course.name + " course",
            url: "/managecourse/" + req.body.courseid + "/goals",
          });
          Course.increment(
            { numberofstudent: 1, revenue: course.cost },
            { where: { _id: req.body.courseid } }
          );
        });
        res.send({ code: 200, message: "success" });
      })
      .catch((err) => {
        console.log(err);
      });
  }
};

exports.getMyWishlist = async (req, res) => {
  const wishlistId = [];
  const ids = await Wishlist.findAll({
    where: { userId: req.user._id },
    raw: true,
  });
  ids.map((id) => {
    wishlistId.push(id.courseId);
  });

  let condition = { public: true };
  condition._id = { [Op.in]: wishlistId };
  if (req.body.level) condition.level = req.body.level;
  if (req.body.free)
    condition.cost = req.body.free == "true" ? 0 : { [Op.gt]: 0 };
  if (req.body.name)
    condition.name = { [Op.substring]: "%" + req.body.name + "%" };
  let sort;
  if (!req.body.sort) sort = ["name", "ASC"];
  else {
    switch (parseInt(req.body.sort)) {
      case 1:
        sort = ["name", "ASC"];
        break;
      case 2:
        sort = ["name", "DESC"];
        break;
    }
  }

  const datas = await Course.findAll({
    where: condition,
    include: {
      model: User,
      as: "lecturer",
      attributes: ["_id", "username", "photo"],
    },
    attributes: [
      "_id",
      "name",
      "coverphoto",
      "cost",
      "numberofstudent",
      "numberofreviews",
      "star",
      "description",
    ],
    limit: 3,
    offset: (req.body.page || 1) * 3 - 3,
    order: [sort],
  });
  datas.map((data) => {
    data.coverphoto = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}/130_73.png`;
    data.lecturer.photo = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.lecturer.photo}/200_200.png`;
  });
  res.json({ code: 200, courses: datas });
};

exports.changeWishlist = async (req, res) => {
  const data = await Wishlist.findOne({
    where: { userId: req.user._id, courseId: req.body.courseid },
  });
  if (!data) {
    await Wishlist.create({
      userId: req.user._id,
      courseId: req.body.courseid,
    }).then(() => {
      return res.send({ code: 200, message: "success", action: "add" });
    });
  } else {
    await Wishlist.destroy({ where: { courseId: req.body.courseid } });
    res.send({ code: 200, message: "success", action: "remove" });
  }
};

exports.getGoalsCourse = async (req, res) => {
  const data = await Course.findOne({
    where: { _id: req.body.courseid, userId: req.user._id },
  });
  if (!data) {
    return res.send({ code: 404, message: "error" });
  }
  res.send({
    code: 200,
    message: "success",
    course: {
      _id: data._id,
      needtoknow: data.needtoknow,
      targetstudent: data.targetstudent,
      willableto: data.willableto,
    },
  });
};

exports.getCourse = async (req, res) => {
  const data = await Course.findOne({
    where: { _id: req.body.courseid, userId: req.user._id },
  });
  if (!data) {
    return res.send({ code: 404, message: "error" });
  }
  res.send({
    code: 200,
    message: "success",
    course: {
      _id: data._id,
      name: data.name,
      public: data.public,
      review: data.review,
      coverphoto: data.coverphoto
        ? `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}`
        : null,
      cost: data.cost,
    },
  });
};

exports.setGoalCourse = async (req, res) => {
  await Course.update(
    {
      needtoknow: req.body.needtoknow,
      targetstudent: req.body.targetstudent,
      willableto: req.body.willableto,
    },
    { where: { _id: req.body.courseid } }
  )
    .then(() => {
      res.send({
        code: 200,
        message: "success",
        course: {
          _id: Number(req.body.courseid),
          needtoknow: req.body.needtoknow,
          targetstudent: req.body.targetstudent,
          willableto: req.body.willableto,
        },
      });
    })
    .catch((err) => console.log(err));
};

exports.getCourseLectures = async (req, res) => {
  const data = await Course.findOne({
    where: { _id: req.body.courseid, userId: req.user._id },
    include: {
      model: Lecture,
      as: "lectures",
    },
  });
  if (!data) {
    return res.send({ code: 404, message: "error" });
  }
  res.send({
    code: 200,
    message: "success",
    course: {
      _id: data._id,
      lectures: data.lectures.map((lecture) => ({
        ...lecture.dataValues,
        video: `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${lecture.dataValues.video}`,
      })),
    },
  });
};

exports.addVideoLectures = async (req, res) => {
  const data = await Lecture.create({
    name: req.body.name,
    courseId: req.body.courseid,
  });
  res.send({
    code: 200,
    message: "success",
    lecture: { _id: data._id, name: data.name },
  });
};

exports.uploadVideoLecture = async (req, res, next) => {
  if (!req.file) {
    res.status(400).send("No file uploaded.");
    return;
  }
  const newFileName = req.body.lectureid + ".mp4";
  await upload.file(`course-videos/${newFileName}`).save(req.file.buffer);
  const publicUrl = `course-videos/${newFileName}`;
  await Lecture.update(
    {
      video: publicUrl,
    },
    { where: { _id: Number(req.body.lectureid) } }
  );
  return res.send({
    code: 200,
    message: "success",
    lecture: {
      _id: Number(req.body.lectureid),
      video: `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${publicUrl}`,
    },
  });
};

exports.uploadVideoPreview = async (req, res, next) => {
  if (!req.file) {
    res.status(400).send("No file uploaded.");
    return;
  }
  const newFileName = req.body.courseid + ".mp4";
  await upload
    .file(`course-preview-videos/${newFileName}`)
    .save(req.file.buffer, {
      metadata: {
        cacheControl: "no-cache, max-age=0",
      },
    });
  const publicUrl = `course-preview-videos/${newFileName}`;
  await Course.update(
    {
      previewvideo: publicUrl,
    },
    { where: { _id: Number(req.body.courseid) } }
  );
  await Course.findOne({ where: { _id: Number(req.body.courseid) } });
  return res.send({
    code: 200,
    message: "success",
    previewvideo: `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${publicUrl}`,
  });
};
exports.setNameLecture = async (req, res) => {
  const data = await Lecture.update(
    { name: req.body.name },
    { where: { _id: req.body.lectureid } }
  );
  return res.send({
    code: 200,
    message: "success",
    lecture: { _id: req.body.lectureid, name: req.body.name },
  });
};

exports.changePreview = async (req, res) => {
  const data = await Lecture.findOne({ where: { _id: req.body.lectureid } });
  data.preview = !data.preview;
  data.save();
  return res.send({
    code: 200,
    message: "success",
    lecture: { _id: req.body.lectureid, preview: data.preview },
  });
};

exports.getDescription = async (req, res) => {
  const data = await Course.findOne({ where: { _id: req.body.courseid } });
  if (!data) {
    return res.send({ code: 404, message: "error" });
  }
  return res.send({
    code: 200,
    message: "success",
    course: {
      _id: data._id,
      name: data.name,
      previewvideo: data.previewvideo
        ? `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.previewvideo}`
        : null,
      description: data.description,
      coverphoto: data.coverphoto
        ? `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}/320_180.png`
        : null,
      genre: data.genreId,
      subgenre: data.subGenreId,
      level: data.level,
    },
  });
};

exports.setDescription = async (req, res, next) => {
  const coverphoto = `course-photos/${req.body.courseid}`;
  const sizes = [
    [320, 180],
    [130, 73],
    [240, 135],
  ];
  if (req.file) {
    sizes.map((size) => {
      sharp(req.file.buffer)
        .resize(size[0], size[1])
        .toBuffer()
        .then(async (data) => {
          await upload
            .file(`${coverphoto}/${size[0]}_${size[1]}.png`)
            .save(data, {
              metadata: {
                cacheControl: "no-cache, max-age=0",
              },
            });
        });
    });
  }

  const updateValue = {
    description: req.body.description,
    name: req.body.name,
    level: req.body.level,
    genre: req.body.genre,
    subgenre: req.body.subgenre,
  };
  if (req.file) {
    updateValue.coverphoto = coverphoto;
  }

  await Course.update(updateValue, {
    where: { _id: req.body.courseid },
  });

  const data = await Course.findOne({
    where: { _id: req.body.courseid },
  });

  return res.send({
    code: 200,
    message: "success",
    course: {
      ...data.dataValues,
      coverphoto: data.coverphoto
        ? `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.coverphoto}/320_180.png`
        : null,
    },
  });
};

exports.setPriceCourse = async (req, res) => {
  await Course.update(
    { cost: req.body.cost },
    { where: { _id: req.body.courseid, userId: req.user._id } }
  );
  res.send({
    code: 200,
    message: "success",
    course: {
      _id: req.body.courseid,
      cost: req.body.cost,
    },
  });
};

exports.deleteCourse = async (req, res) => {
  await Course.destroy({ where: { _id: req.body.courseid } })
    .then((num) => {
      if (num === 1) {
        res.send({ code: 200, message: "success" });
      }
    })
    .catch((err) => {
      console.log(err);
    });
};

exports.publishCourse = async (req, res) => {
  await Course.update({ review: true }, { where: { _id: req.body.courseid } });
  res.send({
    code: 200,
    message: "success",
    course: { _id: req.body.courseid, review: true },
  });
};

exports.addReview = async (req, res) => {
  await Review.create({
    userId: req.user._id,
    courseId: req.body.courseid,
    star: req.body.star,
    content: req.body.content,
  });
  const user = await User.findOne({ _id: req.user._id });
  await Course.findOne({
    where: { _id: req.body.courseid },
    include: { model: User, as: "lecturer" },
  })
    .then(async (data) => {
      let star = data.star ? parseFloat(data.star) : 0;
      let numberofreviews = data.numberofreviews
        ? parseInt(data.numberofreviews)
        : 0;
      star =
        (star * numberofreviews + parseInt(req.body.star)) /
        (numberofreviews + 1);
      numberofreviews++;
      data.star = star;
      data.numberofreviews = numberofreviews;
      data.save();
      await Notification.create({
        senderId: req.user._id,
        receiverId: data.lecturer._id,
        title: req.body.star + " star!",
        message: user.username + " has reviewed in " + data.name + " course",
        url: "/managecourse/" + req.body.courseid + "/goals",
      });
      res.send({ code: 200, message: "success" });
    })
    .catch((err) => console.log(err));
};

exports.getNotification = async (req, res) => {
  const datas = await Notification.findAll({
    where: { receiverId: req.user._id },
    include: { model: User, as: "from", attributes: ["photo", "_id"] },
    limit: 4,
    offset: (req.body.page || 1) * 4 - 4,
  });
datas.map(data => {
  data.from.photo = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.from.photo}/200_200.png`
})
  res.send({ code: 200, notis: datas });
};

exports.markReadNotification = async (req, res) => {
  await Notification.update({ seen: true }, { where: { receiverId: req.user._id, seen: false, _id: req.body.id }});
  res.send({code: 200, message: "success"})
};

exports.deleteVideoLectures = async (req, res) => {
  await Lecture.destroy({ where: { _id: req.body.lectureid } });
  res.send({ code: 200, message: "success" });
};

exports.editProfile = async (req, res) => {
  const { username, biography, website, twitter, youtube, linkedin } = req.body;
  await User.update(
    { username, biography, website, twitter, youtube, linkedin },
    { where: { _id: req.user._id } }
  );
  res.send({ code: 200, message: "success", profile: req.body });
};

exports.editAvatar = async (req, res) => {
  const avatar = `course-avatar/${req.user._id}`;
  const sizes = [50, 100, 200];
  if (req.file) {
    sizes.map((size) => {
      sharp(req.file.buffer)
        .resize(size, size)
        .toBuffer()
        .then(async (data) => {
          await upload.file(`${avatar}/${size}_${size}.png`).save(data, {
            metadata: {
              cacheControl: "no-cache, max-age=0",
            },
          });
        });
    });
  }
  await User.update(
    {
      photo: avatar,
    },
    { where: { _id: req.user._id } }
  );
  const data = await User.findOne({ where: { _id: req.user._id } });
  return res.send({
    code: 200,
    message: "success",
    photo: `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${data.photo}/200_200.png`,
  });
};


exports.markAllReadNotifications = async(req, res) => {
  await Notification.update({ seen: true }, { where: { receiverId: req.user._id, seen: false } });
  res.send({code: 200, message: "success"})
}
