const express = require("express");
const bodyParser = require("body-parser");
const { sequelize } = require("./model");
const generateFilters = require("./utils");
const { Op } = require("sequelize");
const { getProfile } = require("./middleware/getProfile");
const app = express();
app.use(bodyParser.json());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

/**
 * FIX ME!
 * @returns contract by id
 */
app.get("/contracts/:id", getProfile, async (req, res) => {
  try {
    let profile = req.profile.dataValues;
    const { Contract } = req.app.get("models");
    const { id } = req.params;
    let filters = { id, ...generateFilters(profile) };
    const contract = await Contract.findOne({
      where: { ...filters },
    });
    if (!contract)
      return res.status(404).send({
        message: "Contract not found",
      });
    return res.status(200).send({
      message: "Contract retrieved",
      data: { contract },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.get("/contracts", getProfile, async (req, res) => {
  try {
    let profile = req.profile.dataValues;

    const { Contract } = req.app.get("models");
    let filters = generateFilters(profile);
    const contracts = await Contract.findAll({
      where: { ...filters },
    });
    return res.status(200).send({
      message: "Contracts retrieved",
      data: { contracts },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.get("/jobs/unpaid", getProfile, async (req, res) => {
  try {
    let profile = req.profile.dataValues;
    const { Job, Contract } = req.app.get("models");
    let filters = generateFilters(profile);
    const jobs = await Job.findAll({
      where: {
        [Op.or]: [{ paid: false }, { paid: null }],
      },
      include: [
        {
          model: Contract,
          where: { ...filters },
          as: "Contract",
        },
      ],
    });
    return res.status(200).send({
      message: "Jobs retrieved",
      data: { jobs },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.post("/jobs/:job_id/pay", getProfile, async (req, res) => {
  try {
    let profile = req.profile.dataValues;
    const { job_id } = req.params;

    const { Job, Contract, Profile } = req.app.get("models");
    let filters = generateFilters(profile);
    await sequelize.transaction(async (t) => {
      const job = await Job.findOne({
        lock: true,
        where: {
          id: job_id,
        },
        include: [
          {
            model: Contract,
            where: { ...filters },
            as: "Contract",
          },
        ],
      });
      if (!job)
        return res.status(404).send({
          message: "Job not found",
        });
      if (job.paid)
        return res.status(400).send({
          message: "Job already paid for",
        });
      const [contractor, client] = await Promise.all([
        Profile.findOne({
          lock: true,
          where: {
            id: job.Contract.ContractorId,
            type: "contractor",
          },
        }),
        Profile.findOne({
          lock: true,
          where: {
            id: job.Contract.ClientId,
            type: "client",
          },
        }),
      ]);

      // To do Implement transactions and concurrency
      if (client.balance >= job.price) {
        await Promise.all([
          job.update(
            { paid: true, paymentDate: Date.now() },
            { transaction: t }
          ),
          client.update(
            { balance: client.balance - job.price },
            { transaction: t }
          ),
          contractor.update(
            { balance: contractor.balance + job.price },
            { transaction: t }
          ),
        ]);
      } else {
        return res.status(400).send({
          message: "Insufficient balance",
          data: { job },
        });
      }

      return res.status(200).send({
        message: "Job payment successful",
        data: { job },
      });
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.post("/balances/deposit/:userId", getProfile, async (req, res) => {
  try {
    let profile = req.profile.dataValues;
    const { userId } = req.params;
    const { amount } = req.body;

    if (!amount)
      return res.status(400).send({
        message: "Invalid amount",
      });

    const { Profile, Job, Contract } = req.app.get("models");
    let filters = generateFilters(profile);
    const jobs = await Job.findAll({
      attributes: [[sequelize.fn("sum", sequelize.col("price")), "total"]],
      where: {
        [Op.or]: [{ paid: false }, { paid: null }],
      },
      include: [
        {
          model: Contract,
          where: { ...filters },
          as: "Contract",
        },
      ],
      raw: true,
    });
    const totalAmount = (jobs && jobs.length && jobs[0].total) || 0;
    const totalMaxDeposit = (25 / 100) * totalAmount;

    if (amount > totalMaxDeposit)
      return res.status(400).send({
        message: "Amount is greater than total allowable amount",
      });
    const client = await Profile.findOne({
      where: {
        id: userId,
        type: "client",
      },
    });

    if (profile.type !== "client")
      return res.status(400).send({
        message: "You can only deposit if you are a client",
      });

    if (profile.id != userId)
      return res.status(400).send({
        message: "You can only deposit into your account",
      });

    await client.update({ balance: client.balance + amount });

    return res.status(200).send({
      message: "Deposit successful",
      data: { client },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.get("/admin/best-profession", getProfile, async (req, res) => {
  try {
    const { from, to } = {
      from: req.query.from ? new Date(req.query.from) : new Date(1999, 10, 29),
      to: req.query.to ? new Date(req.query.to) : new Date(),
    };

    const { Profile, Job, Contract } = req.app.get("models");
    const job = await Job.findOne({
      where: {
        paid: true,
        createdAt: {
          [Op.between]: [from, to],
        },
      },
      order: [["totalAmount", "DESC"]],
      attributes: [
        "price",
        "description",
        "ContractId",
        [sequelize.fn("sum", sequelize.col("price")), "totalAmount"],
      ],
      group: "profession",
      include: [
        {
          model: Contract,
          attributes: ["ContractorId"],
          as: "Contract",
          include: [
            {
              model: Profile,
              as: "Contractor",
              attributes: ["id", "profession"],
            },
          ],
        },
      ],
      raw: true,
    });
    return res.status(200).send({
      message: "Best Profession fetched successfully",
      data: { job },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});

app.get("/admin/best-clients", getProfile, async (req, res) => {
  try {
    const limit = (req.query && req.query.limit) || 2;
    const { from, to } = {
      from: req.query.from ? new Date(req.query.from) : new Date(1999, 10, 29),
      to: req.query.to ? new Date(req.query.to) : new Date(),
    };

    const { Profile, Job, Contract } = req.app.get("models");
    const jobs = await Job.findAll({
      where: {
        paid: true,
        createdAt: {
          [Op.between]: [from, to],
        },
      },
      limit,
      order: [["paid", "DESC"]],
      attributes: [[sequelize.fn("sum", sequelize.col("price")), "paid"]],
      group: "profession",
      include: [
        {
          model: Contract,
          attributes: ["ClientId"],
          as: "Contract",
          include: [
            {
              model: Profile,
              as: "Contractor",
              attributes: [
                [
                  sequelize.literal("firstName || ' ' ||  lastName"),
                  "fullName",
                ],
              ],
            },
          ],
        },
      ],
      raw: true,
    });
    return res.status(200).send({
      message: "Best Clients fetched successfully",
      data: { jobs },
    });
  } catch (error) {
    return res.status(400).send({
      message: "An error occured",
      error,
    });
  }
});
module.exports = app;
