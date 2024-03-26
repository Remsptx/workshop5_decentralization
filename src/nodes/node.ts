import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import axios from 'axios';
import * as console from "console";
import {delay} from "../utils";


export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  type NodeState = {
    killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
    x: 0 | 1 | "?" | null; // the current consensus value
    decided: boolean | null; // used to know if the node reached finality
    k: number | null; // current step of the node
  };
  let nodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null
  };
  function checkNodeState(nodeId: number) {
    if (isFaulty) {
      nodeState = {
        killed: true,
        x: null,
        decided: null,
        k: null
      };
    }
  }
  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  let received: Map<number, any[]> = new Map();
  let consensus: Map<number, any[]> = new Map();

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !nodeState.killed) {
      if (messageType == "R") {
        if (!received.has(k)) {
          received.set(k, []);
        }
        received.get(k)!.push(x);
        let messageR = received.get(k)!;
        if (messageR.length >= (N - F)) {
          let numberOf0 = messageR.filter((el) => el == 0).length;
          let numberOf1 = messageR.filter((el) => el == 1).length;
          let newX = "?"; //undecided is  default
          if (numberOf0 > (N / 2)) {
            newX = "0";
          } else if (numberOf1 > (N / 2)) {
            newX = "1";
          }
          for (let i = 0; i < N; i++) {
            axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {k: k, x: newX, messageType: "P"});
          }
        }
      } else if (messageType == "P") {
        if (!consensus.has(k)) {
          consensus.set(k, []);
        }
        consensus.get(k)!.push(x);
        let messageP = consensus.get(k)!;
        if (messageP.length >= N - F) {
          let numberOf0 = messageP.filter((el) => el == 0).length;
          let numberOf1 = messageP.filter((el) => el == 1).length;

          if (numberOf0 >= F + 1) {
            nodeState.x = 0;
            nodeState.decided = true;
          } else if (numberOf1 >= F + 1) {
            nodeState.x = 1;
            nodeState.decided = true;
          } else {
            nodeState.k = k + 1;
            for (let i = 0; i < N; i++) {
              axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {k: k + 1, x: nodeState.x, messageType: "R"});
            }
          }
        }
      }
    }
    res.status(200).send("message received");
  });


  node.get("/start", async (req, res) => {

    while (!nodesAreReady()) {
      await delay(5);
    }

    if (!isFaulty) {
      nodeState.x = initialValue;
      nodeState.k = 1;
      nodeState.decided = false;
      for (let i = 0; i < N; i++) {
        await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          k: nodeState.k,
          x: nodeState.x,
          messageType: "R"
        });
      }
    }
    else {
      nodeState.decided = null;
      nodeState.x = null;
      nodeState.k = null;
    }
    res.status(200).send("started");
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(nodeState);
  });

// start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
        `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
