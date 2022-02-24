// import { io } from './socket.io.esm.min.js';

// function assertUnreachable(x) {
//   throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
// }

// const peersEl = document.getElementById("peers");
// const msgsEl = document.getElementById("msgs");
// const msgBufferInputEl = document.getElementById("msgBuffer");
// const mySessionId = Math.random().toString();
// console.log("I am:", mySessionId);
// const peers = new Map();
// window.peers = peers;

// function show(msg) {
//   const newMsgEl = document.createElement("div");
//   newMsgEl.innerText = msg;
//   msgsEl?.appendChild(newMsgEl);
// }

// msgBufferInputEl.onkeydown = (ev) => {
//   if (ev.key === "Enter") {
//     const msg = msgBufferInputEl.value;
//     msgBufferInputEl.value = "";
//     show(msg);
//     for (const [sessionId, {dataChannel}] of peers.entries()) {
//       if (dataChannel === void 0) {
//         console.warn(`Could not send to ${sessionId}; no data channel`);
//         continue;
//       }
//       try {
//         dataChannel.send(msg);
//       } catch (err) {
//         console.error(`Error sending to ${sessionId}: ${err}`);
//       }
//     }
//   }
// };

import React, {useState, useRef, useEffect, useCallback} from 'react';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'react-native-webrtc'
import { GiftedChat } from 'react-native-gifted-chat';
import io from "socket.io-client";

import { Text, View, StyleSheet, TextInput, Button } from 'react-native';

const mySessionId = Math.random().toString();

const Chat = ({ route }) => {
  const peersRef = useRef(new Map());
  // const peerRef = useRef();
  const socketRef = useRef();
  // const otherUser = useRef();
  // const sendChannel = useRef(); // Data channel
  // const { roomID } = route.params;
  const [messages, setMessages] = useState([]); // Chats between the peers will be stored here

  function newPeerConnection() {
    return new RTCPeerConnection({iceServers: [{urls: ["stun:stun.l.google.com:19302"]}]});
  }

  function newPeer(sessionId) {
    if (peersRef.current.has(sessionId)) {
      throw new Error(`Error: we already have a peer with sessionId ${sessionId}`);
    }
    const peerConn = newPeerConnection();
    peerConn.onconnectionstatechange = (ev) => {
      if (peerConn.connectionState === "closed" || peerConn.connectionState === "disconnected" || peerConn.connectionState === "failed") {
        peersRef.current.delete(sessionId);
      }
    };
    peerConn.onicecandidate = (ev) => {
      if (ev.candidate !== null) {
        publishSignalingMsg(sessionId, {
          kind: "ice-candidate",
          fromSessionId: mySessionId,
          candidate: ev.candidate
        });
      }
    };
    const peer = { id: sessionId, peerConn, iceCandidateBuffer: [], dataChannel: void 0 };
    peersRef.current.set(sessionId, peer);
    return peer;
  }

  function getOrCreatePeer(remoteSessionId) {
    return peersRef.current.get(remoteSessionId) || newPeer(remoteSessionId);
  }

  function publishSignalingMsg(toSessionId, signalingMsg) {
    console.log("Sending to", toSessionId, ":", signalingMsg);
    if (signalingMsg.kind === 'offer') {
      socketRef.current.emit('offer', { target: toSessionId, data: signalingMsg });
    }
    if (signalingMsg.kind === 'answer') {
      socketRef.current.emit('answer', { target: toSessionId, data: signalingMsg });
    }
    if (signalingMsg.kind === 'ice-candidate') {
      socketRef.current.emit('ice-candidate', { target: toSessionId, data: signalingMsg });
    }
  }
  
  function setUpDataChannel(dataChannel, peer) {
    peer.dataChannel = dataChannel;
    dataChannel.onmessage = (msgEv) => show(`${peer.id} says: ${msgEv.data}`);
  }
  
  async function setRemoteDescription(peer, description) {
    await peer.peerConn.setRemoteDescription(description);
    if (!peer.peerConn.remoteDescription) {
      throw new Error("remoteDescription not set after setting");
    }
    for (const candidate of peer.iceCandidateBuffer) {
      await peer.peerConn.addIceCandidate(candidate);
    }
    peer.iceCandidateBuffer = [];
  }

  const handleCreateOffer = async (peer) => {
    const desc = await peer.peerConn.createOffer();
    await peer.peerConn.setLocalDescription(desc);
    publishSignalingMsg(remoteSessionId, {
      kind: "offer",
      fromSessionId: mySessionId,
      offer: desc
    });
  };

  const handleHello = async (remoteSessionId) => {
    if (remoteSessionId === mySessionId)
      return;
    if (peersRef.current.has(remoteSessionId)) {
      throw new Error("Received hello from existing peer!");
    }
    console.log("Received hello from", remoteSessionId);
    const peer = newPeer(remoteSessionId);
    setUpDataChannel(peer.peerConn.createDataChannel("myDataChannel"), peer);
    await handleCreateOffer(peer);
  };

  const handleReceiveOffer = async (signalingMsgOffer) => {
    if (signalingMsgOffer.fromSessionId === mySessionId)
      return;
    const fromSessionId = signalingMsgOffer.fromSessionId;
    console.log("Received offer from", fromSessionId);
    const peer = getOrCreatePeer(fromSessionId);
    if (peer.peerConn.remoteDescription) {
      console.warn("Received a second offer from the same peer", peer);
    }
    peer.peerConn.ondatachannel = (dataChannelEv) => {
      setUpDataChannel(dataChannelEv.channel, peer);
    };
    await setRemoteDescription(peer, signalingMsgOffer.offer);
    const answerDesc = await peer.peerConn.createAnswer();
    await peer.peerConn.setLocalDescription(answerDesc);
    publishSignalingMsg(signalingMsgOffer.fromSessionId, {
      kind: "answer",
      fromSessionId: mySessionId,
      answer: answerDesc
    });
  };

  const handleReceiveAnswer = async (signalingMsgAnswer) => {
    if (signalingMsgAnswer.fromSessionId === mySessionId)
      return;
    const fromSessionId = signalingMsgAnswer.fromSessionId;
    console.log("Received answer from", fromSessionId);
    const peer = peers.get(fromSessionId);
    if (peer === void 0) {
      throw new Error("Unexpected answer from a peer we never sent an offer to!");
    }
    if (peer.peerConn.remoteDescription) {
      console.warn("Received a second offer from the same peer", peer);
    }
    await setRemoteDescription(peer, signalingMsgAnswer.answer);
  };
  
  const handleSignalingMsgIceCandidate = async (signalingMsgIceCandidate) => {
    if (signalingMsgIceCandidate.fromSessionId === mySessionId)
      return;
    const fromSessionId = signalingMsgIceCandidate.fromSessionId;
    console.log("Received ICE candidate from", fromSessionId);
    const peer = getOrCreatePeer(fromSessionId);
    if (peer.peerConn.remoteDescription) {
      await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
    } else {
      peer.iceCandidateBuffer.push(signalingMsgIceCandidate.candidate);
    }
  };

  useEffect(() => {
    // Step 1: Connect with the Signal server
    socketRef.current = io.connect("https://ss-test-socket-server.azurewebsites.net"); // Address of the Signal server

    socketRef.current.on("connect", () => {
      console.log("Connected to Socket");
      // Step 2: Join the room. If initiator we will create a new room otherwise we will join a room
      const msg = { fromSessionId: mySessionId };
      socketRef.current.emit("hello", msg); // Room ID

      // Step 3: Waiting for the other peer to join the room
      socketRef.current.on('hello', ({ fromSessionId }) => {
        handleHello(fromSessionId);
      });
  
      socketRef.current.on("offer", handleReceiveOffer);
      
      socketRef.current.on("answer", handleReceiveAnswer);
  
      socketRef.current.on("ice-candidate", handleSignalingMsgIceCandidate);
    });
  }, []);

  // function callUser(userID){
  //   // This will initiate the call for the receiving peer
  //   console.log("[INFO] Initiated a call")
  //   peerRef.current = Peer(userID);
  //   sendChannel.current = peerRef.current.createDataChannel("sendChannel");
    
  //   // listen to incoming messages from other peer
  //   sendChannel.current.onmessage = handleReceiveMessage;
  // }

  // function Peer(userID) {
  //   /* 
  //      Here we are using Turn and Stun server
  //      (ref: https://blog.ivrpowers.com/post/technologies/what-is-stun-turn-server/)
  //   */

  //   const peer = new RTCPeerConnection({
  //     iceServers: [{
  //       urls: ["stun:stun.l.google.com:19302"]
  //     }]
  //   });
  //   peer.onicecandidate = handleICECandidateEvent;
  //   peer.onnegotiationneeded = () => handleNegotiationNeededEvent(userID);
  //   return peer;
  // }

  // function handleNegotiationNeededEvent(userID){
  //   // Offer made by the initiating peer to the receiving peer.
  //   peerRef.current.createOffer().then(offer => {
  //      return peerRef.current.setLocalDescription(offer);
  //   })
  //   .then(() => {
  //     const payload = {
  //       target: userID,
  //       caller: socketRef.current.id,
  //       sdp: peerRef.current.localDescription,
  //     };
  //     socketRef.current.emit("offer", payload);
  //   })
  //   .catch(err => console.log("Error handling negotiation needed event", err));
  // }

  // function handleOffer(incoming) {
  //   /*
  //     Here we are exchanging config information
  //     between the peers to establish communication
  //   */
  //   console.log("[INFO] Handling Offer")
  //   peerRef.current = Peer();
  //   peerRef.current.ondatachannel = (event) => {
  //     sendChannel.current = event.channel;
  //     sendChannel.current.onmessage = handleReceiveMessage;
  //     console.log('[SUCCESS] Connection established')
  //   }

  //   /*
  //     Session Description: It is the config information of the peer
  //     SDP stands for Session Description Protocol. The exchange
  //     of config information between the peers happens using this protocol
  //   */
  //   const desc = new RTCSessionDescription(incoming.sdp);

  //   /* 
  //      Remote Description : Information about the other peer
  //      Local Description: Information about you 'current peer'
  //   */

  //   peerRef.current.setRemoteDescription(desc).then(() => {
  //   }).then(() => {
  //     return peerRef.current.createAnswer();
  //   }).then(answer => {
  //     return peerRef.current.setLocalDescription(answer);
  //   }).then(() => {
  //     const payload = {
  //       target: incoming.caller,
  //       caller: socketRef.current.id,
  //       sdp: peerRef.current.localDescription
  //     }
  //     socketRef.current.emit("answer", payload);
  //   })
  // }

  // function handleAnswer(message){
  //   // Handle answer by the receiving peer
  //   const desc = new RTCSessionDescription(message.sdp);
  //   peerRef.current.setRemoteDescription(desc).catch(e => console.log("Error handle answer", e));
  // }
  
  // function handleReceiveMessage(e){
  //   // Listener for receiving messages from the peer
  //   console.log("[INFO] Message received from peer", e.data);
  //   const msg = [{
  //     _id: Math.random(1000).toString(),
  //     text: e.data,
  //     createdAt: new Date(),
  //     user: {
  //       _id: 2,
  //     },
  //   }];
  //   setMessages(previousMessages => GiftedChat.append(previousMessages, msg))
  // };

  // function handleICECandidateEvent(e) {
  //   /*
  //     ICE stands for Interactive Connectivity Establishment. Using this
  //     peers exchange information over the intenet. When establishing a
  //     connection between the peers, peers generally look for several 
  //     ICE candidates and then decide which to choose best among possible
  //     candidates
  //   */
  //   if (e.candidate) {
  //       const payload = {
  //           target: otherUser.current,
  //           candidate: e.candidate,
  //       }
  //       socketRef.current.emit("ice-candidate", payload);
  //   }
  // }

// function handleNewICECandidateMsg(incoming) {
//   const candidate = new RTCIceCandidate(incoming);

//   peerRef.current.addIceCandidate(candidate)
//       .catch(e => console.log(e));
// }

function sendMessage(messages = []){
  // sendChannel.current.send();
  for (const [sessionId, { dataChannel }] of peers.entries()) {
    if (dataChannel === void 0) {
      console.warn(`Could not send to ${sessionId}; no data channel`);
      continue;
    }
    try {
      dataChannel.send(msg);
    } catch (err) {
      console.error(`Error sending to ${sessionId}: ${err}`);
    }
  }
  setMessages(previousMessages => GiftedChat.append(previousMessages, messages))
}

  return (
    <GiftedChat
      messages = {messages}
      onSend = {messages => sendMessage(messages)}
      user={{
        _id: 1,
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    alignContent: 'center',
  },

  textHeader: {
    fontFamily: "sans-serif",
    fontSize: 22,
    alignSelf: "center",
    marginTop: 20,
  }
})

export default Chat;
